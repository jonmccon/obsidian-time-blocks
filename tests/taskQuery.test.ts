import { describe, it, expect, vi } from 'vitest';
import { parseTaskLine, scanAllTasks, updateTaskLineCompletion, clearTaskScheduledDate } from '../src/utils/taskQuery';
import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import type { TaskItem } from '../src/types';

describe('parseTaskLine', () => {
	it('parses a basic incomplete task', () => {
		const task = parseTaskLine('- [ ] Buy groceries', 'todo.md', 1);
		expect(task).not.toBeNull();
		expect(task?.title).toBe('Buy groceries');
		expect(task?.completed).toBe(false);
		expect(task?.filePath).toBe('todo.md');
		expect(task?.lineNumber).toBe(1);
		expect(task?.id).toBe('todo.md:1');
	});

	it('parses a completed task', () => {
		const task = parseTaskLine('- [x] Done task', 'tasks.md', 5);
		expect(task?.completed).toBe(true);
		expect(task?.title).toBe('Done task');
	});

	it('parses a completed task with uppercase X', () => {
		const task = parseTaskLine('- [X] Done task', 'tasks.md', 5);
		expect(task?.completed).toBe(true);
	});

	it('parses a task with due date emoji', () => {
		const task = parseTaskLine('- [ ] Submit report 📅 2025-06-15', 'work.md', 3);
		expect(task).not.toBeNull();
		expect(task?.dueDate).toBeDefined();
		expect(task?.dueDate?.getFullYear()).toBe(2025);
		expect(task?.dueDate?.getMonth()).toBe(5); // June
		expect(task?.dueDate?.getDate()).toBe(15);
		// Due date should be stripped from title
		expect(task?.title).not.toContain('📅');
	});

	it('parses priority emoji markers', () => {
		expect(parseTaskLine('- [ ] Task 🔺', 'f.md', 1)?.priority).toBe(1); // Highest
		expect(parseTaskLine('- [ ] Task ⏫', 'f.md', 1)?.priority).toBe(2); // High
		expect(parseTaskLine('- [ ] Task 🔼', 'f.md', 1)?.priority).toBe(3); // Medium
		expect(parseTaskLine('- [ ] Task 🔽', 'f.md', 1)?.priority).toBe(4); // Low
		expect(parseTaskLine('- [ ] Task ⏬', 'f.md', 1)?.priority).toBe(5); // Lowest
	});

	it('parses tags from task text', () => {
		const task = parseTaskLine('- [ ] Review PR #work #urgent', 'dev.md', 2);
		expect(task?.tags).toContain('#work');
		expect(task?.tags).toContain('#urgent');
	});

	it('handles indented tasks', () => {
		const task = parseTaskLine('    - [ ] Sub-task', 'notes.md', 10);
		expect(task).not.toBeNull();
		expect(task?.title).toBe('Sub-task');
	});

	it('returns null for non-task lines', () => {
		expect(parseTaskLine('Regular text', 'f.md', 1)).toBeNull();
		expect(parseTaskLine('- Regular list item', 'f.md', 1)).toBeNull();
		expect(parseTaskLine('## Heading', 'f.md', 1)).toBeNull();
		expect(parseTaskLine('', 'f.md', 1)).toBeNull();
	});

	it('strips Tasks-plugin metadata emojis', () => {
		const task = parseTaskLine(
			'- [ ] Task ⏰ 2025-06-10 🛫 2025-06-01 ➕ 2025-05-01',
			'f.md',
			1,
		);
		expect(task).not.toBeNull();
		// Metadata emojis and stray dates should be stripped
		expect(task?.title).not.toContain('⏰');
		expect(task?.title).not.toContain('🛫');
		expect(task?.title).not.toContain('➕');
	});

	it('defaults to "(empty task)" when title is empty after stripping', () => {
		const task = parseTaskLine('- [ ] 📅 2025-06-15', 'f.md', 1);
		expect(task?.title).toBe('(empty task)');
	});

	it('preserves the raw text', () => {
		const raw = '- [ ] Buy milk #shopping 📅 2025-06-15';
		const task = parseTaskLine(raw, 'f.md', 1);
		expect(task?.rawText).toBe(raw);
	});

	it('handles tasks with no priority', () => {
		const task = parseTaskLine('- [ ] Simple task', 'f.md', 1);
		expect(task?.priority).toBeUndefined();
	});

	it('handles tasks with no due date', () => {
		const task = parseTaskLine('- [ ] Simple task', 'f.md', 1);
		expect(task?.dueDate).toBeUndefined();
	});

	it('parses scheduled date emoji (⏰ YYYY-MM-DD)', () => {
		const task = parseTaskLine('- [ ] Write tests ⏰ 2025-03-10', 'work.md', 7);
		expect(task).not.toBeNull();
		expect(task?.scheduledDate).toBeDefined();
		expect(task?.scheduledDate?.getFullYear()).toBe(2025);
		expect(task?.scheduledDate?.getMonth()).toBe(2); // March
		expect(task?.scheduledDate?.getDate()).toBe(10);
		// Scheduled date emoji should be stripped from the title
		expect(task?.title).not.toContain('⏰');
		expect(task?.title).not.toContain('2025-03-10');
	});

	it('returns undefined scheduledDate when no ⏰ marker is present', () => {
		const task = parseTaskLine('- [ ] Simple task', 'f.md', 1);
		expect(task?.scheduledDate).toBeUndefined();
	});

	it('parses both due date and scheduled date when both are present', () => {
		const task = parseTaskLine(
			'- [ ] Deploy app 📅 2025-08-01 ⏰ 2025-07-25',
			'work.md',
			5,
		);
		expect(task?.dueDate?.getMonth()).toBe(7); // August
		expect(task?.scheduledDate?.getMonth()).toBe(6); // July
		expect(task?.title).toBe('Deploy app');
	});

	it('handles tasks with complex content', () => {
		const task = parseTaskLine(
			'- [ ] Review #code and deploy ⏫ 📅 2025-07-01 #devops',
			'projects/deploy.md',
			42,
		);
		expect(task).not.toBeNull();
		expect(task?.priority).toBe(2); // High
		expect(task?.dueDate?.getMonth()).toBe(6); // July
		expect(task?.tags).toContain('#code');
		expect(task?.tags).toContain('#devops');
		expect(task?.filePath).toBe('projects/deploy.md');
		expect(task?.lineNumber).toBe(42);
	});
});

describe('updateTaskLineCompletion', () => {
	it('marks incomplete tasks as complete', () => {
		const updated = updateTaskLineCompletion('- [ ] Buy groceries', true);
		expect(updated).toBe('- [x] Buy groceries');
	});

	it('marks completed tasks as incomplete', () => {
		const updated = updateTaskLineCompletion('  - [x] Done task', false);
		expect(updated).toBe('  - [ ] Done task');
	});

	it('normalizes uppercase completion markers', () => {
		const updated = updateTaskLineCompletion('- [X] Done task', true);
		expect(updated).toBe('- [x] Done task');
	});

	it('returns null for non-task lines', () => {
		const updated = updateTaskLineCompletion('Regular text', true);
		expect(updated).toBeNull();
	});
});

describe('clearTaskScheduledDate', () => {
	function makeTask(line: string, lineNumber = 1): TaskItem {
		return parseTaskLine(line, 'tasks.md', lineNumber) as TaskItem;
	}

	function makeApp(lines: string[]) {
		const content = lines.join('\n');
		let stored = content;

		class MockFile extends TFile {
			override path = 'tasks.md';
		}
		const file = new MockFile();

		return {
			vault: {
				getAbstractFileByPath: () => file,
				read: async () => stored,
				modify: async (_f: unknown, newContent: string) => {
					stored = newContent;
				},
				get: () => stored,
			},
			_stored: () => stored,
		} as unknown as Parameters<typeof clearTaskScheduledDate>[0];
	}

	it('removes the ⏰ date token from a task line', async () => {
		const line = '- [ ] Write tests ⏰ 2025-03-10';
		const task = makeTask(line);
		const app = makeApp([line]);
		const result = await clearTaskScheduledDate(app, task);
		expect(result).toBe(true);
		const stored = (app as unknown as { _stored: () => string })._stored();
		expect(stored).toBe('- [ ] Write tests');
	});

	it('removes ⏰ date even when surrounded by other metadata', async () => {
		const line = '- [ ] Deploy app 📅 2025-08-01 ⏰ 2025-07-25';
		const task = makeTask(line);
		const app = makeApp([line]);
		await clearTaskScheduledDate(app, task);
		const stored = (app as unknown as { _stored: () => string })._stored();
		expect(stored).not.toContain('⏰');
		expect(stored).toContain('📅 2025-08-01');
	});

	it('returns true and leaves file unchanged when no ⏰ token is present', async () => {
		const line = '- [ ] No scheduled date';
		const task = makeTask(line);
		const app = makeApp([line]);
		const result = await clearTaskScheduledDate(app, task);
		expect(result).toBe(true);
		const stored = (app as unknown as { _stored: () => string })._stored();
		expect(stored).toBe(line);
	});
});

describe('scanAllTasks', () => {
	it('deduplicates files when getMarkdownFiles returns the same path twice', async () => {
		// Simulate the Obsidian vault returning duplicate TFile entries for the
		// same path (can happen during vault sync or metadata cache rebuilds).
		const fileA = { path: 'notes.md' };
		const mockApp = {
			vault: {
				// Return the same file object twice to mimic the duplicated-entry bug
				getMarkdownFiles: vi.fn(() => [fileA, fileA]),
				cachedRead: vi.fn(async () => '- [ ] Buy milk\n'),
			},
		} as unknown as App;

		const tasks = await scanAllTasks(mockApp);

		// Each task id encodes path + line number; with deduplication only one
		// entry should be present even though getMarkdownFiles returned two.
		expect(tasks).toHaveLength(1);
		expect(tasks[0]?.id).toBe('notes.md:1');
		// The file was only read once
		expect(mockApp.vault.cachedRead).toHaveBeenCalledTimes(1);
	});
});
