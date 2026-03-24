import { describe, it, expect } from 'vitest';
import { parseTaskLine, updateTaskLineCompletion } from '../src/utils/taskQuery';

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
