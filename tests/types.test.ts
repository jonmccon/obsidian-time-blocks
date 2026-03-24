import { describe, it, expect } from 'vitest';
import { createCalendarFeedId, DEFAULT_SETTINGS } from '../src/settings';
import type { ScheduledBlock, TaskItem, GCalEvent, TimeBlockData } from '../src/types';

describe('DEFAULT_SETTINGS', () => {
	it('has expected default values', () => {
		expect(DEFAULT_SETTINGS.calendarFeeds).toEqual([]);
		expect(DEFAULT_SETTINGS.defaultTaskDuration).toBe(30);
		expect(DEFAULT_SETTINGS.workdayStart).toBe(8);
		expect(DEFAULT_SETTINGS.workdayEnd).toBe(18);
		expect(DEFAULT_SETTINGS.taskBlockColor).toBe('#7B61FF');
		expect(DEFAULT_SETTINGS.gcalEventColor).toBe('#4285F4');
		expect(DEFAULT_SETTINGS.showCompletedTasks).toBe(false);
		expect(DEFAULT_SETTINGS.taskTagFilter).toBe('');
		expect(DEFAULT_SETTINGS.backlogMode).toBe('all');
		expect(DEFAULT_SETTINGS.customTaskQuery).toBe('');
		expect(DEFAULT_SETTINGS.tagColors).toEqual({});
		// Two-way sync defaults
		expect(DEFAULT_SETTINGS.enableTwoWaySync).toBe(false);
		expect(DEFAULT_SETTINGS.oauthClientId).toBe('');
		expect(DEFAULT_SETTINGS.oauthTokens).toBeNull();
		expect(DEFAULT_SETTINGS.syncCalendarId).toBe('primary');
		expect(DEFAULT_SETTINGS.conflictStrategy).toBe('ask');
		expect(DEFAULT_SETTINGS.writableCalendarIds).toEqual([]);
	});

	it('workday start is before workday end', () => {
		expect(DEFAULT_SETTINGS.workdayStart).toBeLessThan(DEFAULT_SETTINGS.workdayEnd);
	});

	it('default task duration is within valid range (15-240)', () => {
		expect(DEFAULT_SETTINGS.defaultTaskDuration).toBeGreaterThanOrEqual(15);
		expect(DEFAULT_SETTINGS.defaultTaskDuration).toBeLessThanOrEqual(240);
	});

	it('colors are valid hex strings', () => {
		const hexPattern = /^#[0-9A-Fa-f]{6}$/;
		expect(DEFAULT_SETTINGS.taskBlockColor).toMatch(hexPattern);
		expect(DEFAULT_SETTINGS.gcalEventColor).toMatch(hexPattern);
	});

	it('creates calendar feed ids', () => {
		const id = createCalendarFeedId();
		const otherId = createCalendarFeedId();
		expect(id).toMatch(/^calendar-/);
		expect(otherId).toMatch(/^calendar-/);
		expect(id).not.toBe(otherId);
	});
});

describe('ScheduledBlock type shape', () => {
	it('creates a valid ScheduledBlock object', () => {
		const block: ScheduledBlock = {
			id: 'block-1',
			title: 'Test block',
			weekStart: '2025-06-09',
			dayIndex: 0,
			startHour: 9,
			startMinute: 0,
			duration: 60,
			color: '#7B61FF',
			source: 'task',
		};

		expect(block.id).toBe('block-1');
		expect(block.source).toBe('task');
		expect(block.dayIndex).toBeGreaterThanOrEqual(0);
		expect(block.dayIndex).toBeLessThanOrEqual(6);
	});

	it('supports all source types', () => {
		const sources: ScheduledBlock['source'][] = ['task', 'gcal', 'manual'];
		sources.forEach((source) => {
			const block: ScheduledBlock = {
				id: `block-${source}`,
				title: 'Test',
				weekStart: '2025-06-09',
				dayIndex: 0,
				startHour: 9,
				startMinute: 0,
				duration: 30,
				color: '#000000',
				source,
			};
			expect(block.source).toBe(source);
		});
	});

	it('supports optional taskId and gcalEventId', () => {
		const block: ScheduledBlock = {
			id: 'block-ref',
			taskId: 'file.md:5',
			gcalEventId: 'gcal-123',
			title: 'Test',
			weekStart: '2025-06-09',
			dayIndex: 0,
			startHour: 9,
			startMinute: 0,
			duration: 30,
			color: '#000000',
			source: 'task',
		};
		expect(block.taskId).toBe('file.md:5');
		expect(block.gcalEventId).toBe('gcal-123');
	});
});

describe('TaskItem type shape', () => {
	it('creates a valid TaskItem object', () => {
		const task: TaskItem = {
			id: 'file.md:1',
			title: 'My task',
			filePath: 'file.md',
			lineNumber: 1,
			completed: false,
			tags: ['#work'],
			rawText: '- [ ] My task #work',
		};

		expect(task.id).toBe('file.md:1');
		expect(task.completed).toBe(false);
		expect(task.tags).toContain('#work');
	});

	it('supports optional dueDate and priority', () => {
		const task: TaskItem = {
			id: 'f:1',
			title: 'Task',
			dueDate: new Date('2025-06-15'),
			priority: 2,
			filePath: 'f.md',
			lineNumber: 1,
			completed: false,
			tags: [],
			rawText: '- [ ] Task',
		};

		expect(task.dueDate).toBeInstanceOf(Date);
		expect(task.priority).toBe(2);
	});
});

describe('GCalEvent type shape', () => {
	it('creates a valid GCalEvent object', () => {
		const event: GCalEvent = {
			id: 'event-1',
			title: 'Meeting',
			start: new Date('2025-06-11T09:00:00Z'),
			end: new Date('2025-06-11T10:00:00Z'),
			isAllDay: false,
		};

		expect(event.id).toBe('event-1');
		expect(event.isAllDay).toBe(false);
	});

	it('supports optional description and location', () => {
		const event: GCalEvent = {
			id: 'event-2',
			title: 'Conference',
			start: new Date('2025-06-15'),
			end: new Date('2025-06-16'),
			isAllDay: true,
			description: 'Annual conference',
			location: 'Convention center',
		};

		expect(event.description).toBe('Annual conference');
		expect(event.location).toBe('Convention center');
	});
});

describe('TimeBlockData type shape', () => {
	it('creates a valid TimeBlockData object', () => {
		const data: TimeBlockData = {
			version: 1,
			blocks: [],
		};

		expect(data.version).toBe(1);
		expect(data.blocks).toEqual([]);
	});
});
