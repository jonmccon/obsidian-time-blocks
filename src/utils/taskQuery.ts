import { App } from 'obsidian';
import { TaskItem } from '../types';

/**
 * Emoji markers used by the Obsidian Tasks community plugin.
 * https://obsidian-tasks-group.github.io/obsidian-tasks/
 */
const PRIORITY_MAP: Record<string, number> = {
	'🔺': 1, // Highest
	'⏫': 2, // High
	'🔼': 3, // Medium
	'🔽': 4, // Low
	'⏬': 5, // Lowest
};

/** Regex that matches Tasks-plugin-style emoji priority markers. */
const PRIORITY_REGEX = /[🔺⏫🔼🔽⏬]/u;

/** Tries to parse a single markdown list line as a task item. */
function parseTaskLine(
	line: string,
	filePath: string,
	lineNumber: number
): TaskItem | null {
	// Match: optional indent, "- [ ]" or "- [x]" / "- [X]", then content
	const match = line.match(/^(\s*)-\s+\[([ xX])\]\s+(.*)$/);
	if (!match) return null;

	const completed = (match[2] ?? '').toLowerCase() === 'x';
	let title = (match[3] ?? '').trim();

	// --- Parse due date (Tasks plugin: 📅 YYYY-MM-DD) ---
	let dueDate: Date | undefined;
	const dueDateMatch = title.match(/📅\s*(\d{4}-\d{2}-\d{2})/);
	if (dueDateMatch) {
		const raw = dueDateMatch[1];
		if (raw) dueDate = new Date(`${raw}T00:00:00`);
		title = title.replace(/📅\s*\d{4}-\d{2}-\d{2}/, '').trim();
	}

	// --- Parse priority ---
	let priority: number | undefined;
	const prioMatch = title.match(PRIORITY_REGEX);
	if (prioMatch) {
		priority = PRIORITY_MAP[prioMatch[0]];
		title = title.replace(prioMatch[0], '').trim();
	}

	// --- Extract tags (#tag) ---
	const tags = (title.match(/#[\w/-]+/g) ?? []) as string[];

	// --- Strip other Tasks plugin metadata emojis ---
	// Scheduled (⏰), start (🛫), created (➕), done (✅), cancelled (❌), repeat (🔁)
	title = title
		.replace(/[⏰🛫➕✅❌🔁]/gu, '')
		.replace(/\d{4}-\d{2}-\d{2}/g, '') // stray date strings
		.replace(/\s{2,}/g, ' ')
		.trim();

	if (!title) title = '(empty task)';

	return {
		id: `${filePath}:${lineNumber}`,
		title,
		dueDate,
		priority,
		filePath,
		lineNumber,
		completed,
		tags,
		rawText: line,
	};
}

export interface TaskQueryFilter {
	/** When true, include completed tasks. Defaults to false. */
	showCompleted?: boolean;
	/** When set, only include tasks that contain this tag (e.g. "#work"). */
	tagFilter?: string;
}

/**
 * Scans all markdown files in the vault and returns task items compatible
 * with the Obsidian Tasks community plugin format.
 *
 * Results are sorted by:
 *  1. Priority (ascending, 1 = highest)
 *  2. Due date (earliest first)
 *  3. Title (alphabetical)
 */
export async function queryTasks(
	app: App,
	filter: TaskQueryFilter = {}
): Promise<TaskItem[]> {
	const markdownFiles = app.vault.getMarkdownFiles();

	const perFile = await Promise.all(
		markdownFiles.map(async (file) => {
			try {
				const content = await app.vault.cachedRead(file);
				const lines = content.split('\n');
				const tasks: TaskItem[] = [];

				for (let i = 0; i < lines.length; i++) {
					const line = lines[i];
					if (!line) continue;
					const task = parseTaskLine(line, file.path, i + 1);
					if (!task) continue;
					if (!filter.showCompleted && task.completed) continue;
					if (
						filter.tagFilter &&
						!task.tags.includes(filter.tagFilter)
					)
						continue;
					tasks.push(task);
				}

				return tasks;
			} catch {
				return [];
			}
		})
	);

	const all = perFile.flat();

	all.sort((a, b) => {
		// Priority (lower number = higher priority; undefined goes last)
		const pa = a.priority ?? 999;
		const pb = b.priority ?? 999;
		if (pa !== pb) return pa - pb;

		// Due date (earlier first; no date goes last)
		const da = a.dueDate?.getTime() ?? Infinity;
		const db = b.dueDate?.getTime() ?? Infinity;
		if (da !== db) return da - db;

		return a.title.localeCompare(b.title);
	});

	return all;
}
