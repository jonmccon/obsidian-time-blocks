import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runSync, type SyncDeps } from '../../src/gcal/syncEngine';
import type {
	EventMapping,
	GoogleCalendarEvent,
} from '../../src/gcal/types';
import type { ScheduledBlock } from '../../src/types';

// Mock the calendarApi module
vi.mock('../../src/gcal/calendarApi', () => ({
	listEvents: vi.fn(),
	createEvent: vi.fn(),
	updateEvent: vi.fn(),
	deleteEvent: vi.fn(),
}));

import {
	listEvents,
	createEvent,
	updateEvent,
	deleteEvent,
} from '../../src/gcal/calendarApi';

const mockedListEvents = vi.mocked(listEvents);
const mockedCreateEvent = vi.mocked(createEvent);
const mockedUpdateEvent = vi.mocked(updateEvent);
const mockedDeleteEvent = vi.mocked(deleteEvent);

function makeBlock(overrides?: Partial<ScheduledBlock>): ScheduledBlock {
	return {
		id: 'block-1',
		title: 'Test task',
		weekStart: '2025-06-09',
		dayIndex: 0,
		startHour: 9,
		startMinute: 0,
		duration: 60,
		color: '#7B61FF',
		source: 'task',
		...overrides,
	};
}

function makeRemoteEvent(
	overrides?: Partial<GoogleCalendarEvent>
): GoogleCalendarEvent {
	return {
		id: 'google-event-1',
		summary: 'Test task',
		status: 'confirmed',
		start: { dateTime: '2025-06-09T09:00:00.000Z' },
		end: { dateTime: '2025-06-09T10:00:00.000Z' },
		updated: '2025-06-09T07:00:00Z',
		...overrides,
	};
}

function makeDeps(overrides?: {
	blocks?: ScheduledBlock[];
	mappings?: EventMapping[];
}): SyncDeps {
	let blocks = overrides?.blocks ?? [];
	let mappings = overrides?.mappings ?? [];

	return {
		api: {
			getTokens: () => ({
				access_token: 'test-token',
				expires_at: Date.now() + 3600_000,
				token_type: 'Bearer',
				scope: 'calendar',
			}),
			saveTokens: vi.fn(),
			clientId: 'test-client',
		},
		targetCalendarId: 'primary',
		conflictStrategy: 'local-wins',
		getBlocks: () => blocks,
		setBlocks: (b) => { blocks = b; },
		getMappings: () => mappings,
		saveMappings: vi.fn(async (m) => { mappings = m; }),
	};
}

describe('runSync', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('creates a remote event for a new local block', async () => {
		const block = makeBlock();
		const deps = makeDeps({ blocks: [block] });

		mockedListEvents.mockResolvedValue([]);
		mockedCreateEvent.mockResolvedValue(
			makeRemoteEvent({ id: 'new-google-id' })
		);

		const result = await runSync(deps, '2025-06-09');

		expect(result.created).toBe(1);
		expect(result.errors).toHaveLength(0);
		expect(mockedCreateEvent).toHaveBeenCalledTimes(1);
		expect(deps.saveMappings).toHaveBeenCalled();
	});

	it('skips gcal-source blocks (does not push them back)', async () => {
		const block = makeBlock({ source: 'gcal' });
		const deps = makeDeps({ blocks: [block] });

		mockedListEvents.mockResolvedValue([]);

		const result = await runSync(deps, '2025-06-09');

		expect(result.created).toBe(0);
		expect(mockedCreateEvent).not.toHaveBeenCalled();
	});

	it('deletes remote event when local block is removed', async () => {
		const mapping: EventMapping = {
			blockId: 'deleted-block',
			googleEventId: 'google-event-1',
			calendarId: 'primary',
			lastRemoteUpdate: '2025-06-09T07:00:00Z',
			lastLocalPush: '2025-06-09T07:30:00Z',
		};

		const deps = makeDeps({ blocks: [], mappings: [mapping] });

		mockedListEvents.mockResolvedValue([]);
		mockedDeleteEvent.mockResolvedValue(undefined);

		const result = await runSync(deps, '2025-06-09');

		expect(result.deleted).toBeGreaterThanOrEqual(1);
		expect(mockedDeleteEvent).toHaveBeenCalledWith(
			deps.api,
			'primary',
			'google-event-1'
		);
	});

	it('handles API fetch errors gracefully', async () => {
		const deps = makeDeps({ blocks: [makeBlock()] });
		mockedListEvents.mockRejectedValue(new Error('Network error'));

		const result = await runSync(deps, '2025-06-09');

		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]).toContain('Network error');
	});

	it('reports conflict when both sides changed', async () => {
		const block = makeBlock({ title: 'Local title' });
		const mapping: EventMapping = {
			blockId: block.id,
			googleEventId: 'google-event-1',
			calendarId: 'primary',
			lastRemoteUpdate: '2025-06-09T07:00:00Z',
			lastLocalPush: '2025-06-09T07:30:00Z',
		};

		const remote = makeRemoteEvent({
			summary: 'Remote title',
			updated: '2025-06-09T08:00:00Z', // After lastLocalPush
		});

		const deps = makeDeps({
			blocks: [block],
			mappings: [mapping],
		});
		// Use local-wins so the conflict is resolved
		deps.conflictStrategy = 'local-wins';

		mockedListEvents.mockResolvedValue([remote]);
		mockedUpdateEvent.mockResolvedValue(
			makeRemoteEvent({ summary: 'Local title', updated: '2025-06-09T09:00:00Z' })
		);

		const result = await runSync(deps, '2025-06-09');

		// With 'local-wins', local changes should be pushed
		expect(result.updated).toBe(1);
		expect(result.conflicts).toHaveLength(0);
	});

	it('skips conflicts with "ask" strategy', async () => {
		const block = makeBlock({ title: 'Local title' });
		const mapping: EventMapping = {
			blockId: block.id,
			googleEventId: 'google-event-1',
			calendarId: 'primary',
			lastRemoteUpdate: '2025-06-09T07:00:00Z',
			lastLocalPush: '2025-06-09T07:30:00Z',
		};

		const remote = makeRemoteEvent({
			summary: 'Remote title',
			updated: '2025-06-09T08:00:00Z',
		});

		const deps = makeDeps({
			blocks: [block],
			mappings: [mapping],
		});
		deps.conflictStrategy = 'ask';

		mockedListEvents.mockResolvedValue([remote]);

		const result = await runSync(deps, '2025-06-09');

		expect(result.conflicts).toHaveLength(1);
		expect(result.conflicts[0]?.localTitle).toBe('Local title');
		expect(result.conflicts[0]?.remoteTitle).toBe('Remote title');
	});

	it('removes mapping when remote event was deleted', async () => {
		const block = makeBlock();
		const mapping: EventMapping = {
			blockId: block.id,
			googleEventId: 'google-event-deleted',
			calendarId: 'primary',
			lastRemoteUpdate: '2025-06-09T07:00:00Z',
			lastLocalPush: '2025-06-09T07:30:00Z',
		};

		const deps = makeDeps({
			blocks: [block],
			mappings: [mapping],
		});

		// Remote returns empty — the event was deleted
		mockedListEvents.mockResolvedValue([]);

		const result = await runSync(deps, '2025-06-09');

		expect(result.deleted).toBeGreaterThanOrEqual(1);
	});

	it('removes mapping when remote event is cancelled', async () => {
		const block = makeBlock();
		const mapping: EventMapping = {
			blockId: block.id,
			googleEventId: 'google-event-1',
			calendarId: 'primary',
			lastRemoteUpdate: '2025-06-09T07:00:00Z',
			lastLocalPush: '2025-06-09T08:00:00Z',
		};

		const deps = makeDeps({
			blocks: [block],
			mappings: [mapping],
		});

		const cancelledEvent = makeRemoteEvent({
			status: 'cancelled',
			updated: '2025-06-09T07:00:00Z',
		});

		mockedListEvents.mockResolvedValue([cancelledEvent]);

		await runSync(deps, '2025-06-09');

		// The saveMappings call should have been made with the mapping removed
		expect(deps.saveMappings).toHaveBeenCalled();
	});
});
