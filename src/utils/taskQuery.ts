import { App, TFile } from 'obsidian';
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
const TASK_LINE_REGEX = /^(\s*-\s+\[)([ xX])(\]\s+.*)$/;

/** Tries to parse a single markdown list line as a task item. */
export function parseTaskLine(
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

	// --- Parse scheduled date (Tasks plugin: ⏰ YYYY-MM-DD) ---
	let scheduledDate: Date | undefined;
	const scheduledDateMatch = title.match(/⏰\s*(\d{4}-\d{2}-\d{2})/);
	if (scheduledDateMatch) {
		const raw = scheduledDateMatch[1];
		if (raw) scheduledDate = new Date(`${raw}T00:00:00`);
		title = title.replace(/⏰\s*\d{4}-\d{2}-\d{2}/, '').trim();
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
		scheduledDate,
		priority,
		filePath,
		lineNumber,
		completed,
		tags,
		rawText: line,
	};
}

export function updateTaskLineCompletion(
	line: string,
	completed: boolean
): string | null {
	const match = line.match(TASK_LINE_REGEX);
	if (!match) return null;
	const marker = completed ? 'x' : ' ';
	return `${match[1]}${marker}${match[3]}`;
}

export async function setTaskCompletion(
	app: App,
	task: TaskItem,
	completed: boolean
): Promise<boolean> {
	const file = app.vault.getAbstractFileByPath(task.filePath);
	if (!(file instanceof TFile)) return false;

	const content = await app.vault.read(file);
	const lines = content.split('\n');
	const index = task.lineNumber - 1;
	if (index < 0 || index >= lines.length) return false;

	const currentLine = lines[index]!;
	const updated = updateTaskLineCompletion(currentLine, completed);
	if (!updated) return false;
	if (updated === lines[index]) return true;

	lines[index] = updated;
	await app.vault.modify(file, lines.join('\n'));
	return true;
}

/**
 * Removes the scheduled-date token (⏰ YYYY-MM-DD) from a task line in the
 * vault.  Returns true if the file was updated (or no change was needed),
 * false if the file could not be found or the line is not a valid task.
 */
export async function clearTaskScheduledDate(
	app: App,
	task: TaskItem
): Promise<boolean> {
	const file = app.vault.getAbstractFileByPath(task.filePath);
	if (!(file instanceof TFile)) return false;

	const content = await app.vault.read(file);
	const lines = content.split('\n');
	const index = task.lineNumber - 1;
	if (index < 0 || index >= lines.length) return false;

	const currentLine = lines[index]!;
	// Remove "⏰ YYYY-MM-DD" (with optional surrounding spaces)
	const updated = currentLine.replace(/\s*⏰\s*\d{4}-\d{2}-\d{2}/g, '').trimEnd();
	if (updated === currentLine) return true; // Nothing to remove

	lines[index] = updated;
	await app.vault.modify(file, lines.join('\n'));
	return true;
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
	filter: TaskQueryFilter = {},
	sourceTasks?: TaskItem[]
): Promise<TaskItem[]> {
	const all = sourceTasks ?? (await scanAllTasks(app));

	const filtered = all.filter((task) => {
		if (!filter.showCompleted && task.completed) return false;
		if (filter.tagFilter && !task.tags.includes(filter.tagFilter)) return false;
		return true;
	});

	return sortTasksDefault(filtered);
}

/**
 * Scans all markdown files and returns every task with no filtering applied.
 * Intended for use with the custom-query pipeline where the queryFilter
 * module handles filtering and sorting.
 */
export async function scanAllTasks(app: App): Promise<TaskItem[]> {
	// Deduplicate by path: getMarkdownFiles() can return the same file more than
	// once while the vault metadata cache is being rebuilt (e.g. during sync or
	// after a vault reload).  Processing a file twice would produce identical
	// task objects that share the same id, causing visible duplicates in the
	// backlog list.
	const seen = new Set<string>();
	const markdownFiles = app.vault.getMarkdownFiles().filter((f) => {
		if (seen.has(f.path)) return false;
		seen.add(f.path);
		return true;
	});

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
					if (task) tasks.push(task);
				}

				return tasks;
			} catch {
				return [];
			}
		})
	);

	return perFile.flat();
}

/** Default sort: priority → due date → title. */
function sortTasksDefault(tasks: TaskItem[]): TaskItem[] {
	return tasks.sort((a, b) => {
		const pa = a.priority ?? 999;
		const pb = b.priority ?? 999;
		if (pa !== pb) return pa - pb;

		const da = a.dueDate?.getTime() ?? Infinity;
		const db = b.dueDate?.getTime() ?? Infinity;
		if (da !== db) return da - db;

		return a.title.localeCompare(b.title);
	});
}
