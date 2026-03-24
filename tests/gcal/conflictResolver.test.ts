import { describe, it, expect } from 'vitest';
import {
	detectConflict,
	resolveConflict,
	blockToISOStart,
	blockToISOEnd,
} from '../../src/gcal/conflictResolver';
import type { ScheduledBlock } from '../../src/types';
import type { EventMapping, GoogleCalendarEvent } from '../../src/gcal/types';

function makeBlock(overrides?: Partial<ScheduledBlock>): ScheduledBlock {
	return {
		id: 'block-1',
		title: 'Test task',
		weekStart: '2025-06-09', // Monday
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
		updated: '2025-06-09T08:00:00Z',
		...overrides,
	};
}

function makeMapping(overrides?: Partial<EventMapping>): EventMapping {
	return {
		blockId: 'block-1',
		googleEventId: 'google-event-1',
		calendarId: 'primary',
		lastRemoteUpdate: '2025-06-09T07:00:00Z',
		lastLocalPush: '2025-06-09T07:30:00Z',
		...overrides,
	};
}

describe('blockToISOStart', () => {
	it('converts block start time to ISO string', () => {
		const block = makeBlock();
		const iso = blockToISOStart(block);
		expect(iso).toContain('2025-06-09');
		expect(iso).toContain('09:00:00');
	});

	it('handles non-zero dayIndex', () => {
		const block = makeBlock({ dayIndex: 2 }); // Wednesday
		const iso = blockToISOStart(block);
		expect(iso).toContain('2025-06-11');
	});

	it('handles non-zero minutes', () => {
		const block = makeBlock({ startMinute: 30 });
		const iso = blockToISOStart(block);
		expect(iso).toContain('09:30:00');
	});
});

describe('blockToISOEnd', () => {
	it('converts block end time to ISO string', () => {
		const block = makeBlock({ startHour: 9, startMinute: 0, duration: 60 });
		const iso = blockToISOEnd(block);
		expect(iso).toContain('10:00:00');
	});

	it('handles duration crossing hour boundary', () => {
		const block = makeBlock({ startHour: 9, startMinute: 45, duration: 30 });
		const iso = blockToISOEnd(block);
		expect(iso).toContain('10:15:00');
	});
});

describe('detectConflict', () => {
	it('returns null when remote was not updated since last push', () => {
		const block = makeBlock();
		const remote = makeRemoteEvent({
			updated: '2025-06-09T07:00:00Z', // Before lastLocalPush
		});
		const mapping = makeMapping({ lastLocalPush: '2025-06-09T07:30:00Z' });

		expect(detectConflict(block, remote, mapping)).toBeNull();
	});

	it('returns null when both sides agree (no real conflict)', () => {
		const block = makeBlock();
		const startISO = blockToISOStart(block);
		const endISO = blockToISOEnd(block);

		const remote = makeRemoteEvent({
			summary: block.title,
			start: { dateTime: startISO },
			end: { dateTime: endISO },
			updated: '2025-06-09T08:00:00Z', // After lastLocalPush
		});
		const mapping = makeMapping({ lastLocalPush: '2025-06-09T07:30:00Z' });

		expect(detectConflict(block, remote, mapping)).toBeNull();
	});

	it('detects title conflict', () => {
		const block = makeBlock({ title: 'Local title' });
		const startISO = blockToISOStart(block);
		const endISO = blockToISOEnd(block);

		const remote = makeRemoteEvent({
			summary: 'Remote title',
			start: { dateTime: startISO },
			end: { dateTime: endISO },
			updated: '2025-06-09T08:00:00Z',
		});
		const mapping = makeMapping({ lastLocalPush: '2025-06-09T07:30:00Z' });

		const conflict = detectConflict(block, remote, mapping);
		expect(conflict).not.toBeNull();
		expect(conflict?.localTitle).toBe('Local title');
		expect(conflict?.remoteTitle).toBe('Remote title');
	});

	it('detects time conflict', () => {
		const block = makeBlock({ startHour: 10 }); // Local: 10 AM
		const remote = makeRemoteEvent({
			summary: block.title,
			start: { dateTime: '2025-06-09T11:00:00.000Z' }, // Remote: 11 AM
			end: { dateTime: '2025-06-09T12:00:00.000Z' },
			updated: '2025-06-09T08:00:00Z',
		});
		const mapping = makeMapping({ lastLocalPush: '2025-06-09T07:30:00Z' });

		const conflict = detectConflict(block, remote, mapping);
		expect(conflict).not.toBeNull();
	});
});

describe('resolveConflict', () => {
	const conflict = {
		blockId: 'block-1',
		googleEventId: 'google-event-1',
		localTitle: 'Local',
		remoteTitle: 'Remote',
		localTime: { start: 'a', end: 'b' },
		remoteTime: { start: 'c', end: 'd' },
	};

	it('returns local-wins for "local-wins" strategy', () => {
		const result = resolveConflict(conflict, 'local-wins');
		expect(result.winner).toBe('local');
	});

	it('returns remote-wins for "remote-wins" strategy', () => {
		const result = resolveConflict(conflict, 'remote-wins');
		expect(result.winner).toBe('remote');
	});

	it('returns skip for "ask" strategy', () => {
		const result = resolveConflict(conflict, 'ask');
		expect(result.winner).toBe('skip');
	});
});
