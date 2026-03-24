/**
 * Conflict resolution for two-way Google Calendar sync.
 *
 * When the same event is modified in both Obsidian and Google Calendar between
 * sync cycles, a conflict exists.  This module detects conflicts and resolves
 * them according to the user's chosen strategy.
 */

import type { ScheduledBlock } from '../types';
import type {
	ConflictStrategy,
	EventMapping,
	GoogleCalendarEvent,
	SyncConflict,
} from './types';

/** Describes the winning side after conflict resolution. */
export type ResolutionResult =
	| { winner: 'local' }
	| { winner: 'remote' }
	| { winner: 'skip' };

/**
 * Detects whether a conflict exists between a local block and its remote event.
 *
 * A conflict exists when:
 * 1. The remote event was updated after the last time we pushed local changes.
 * 2. The local block differs from what we last pushed.
 *
 * In practice we compare the remote `updated` timestamp against the mapping's
 * `lastLocalPush` to detect remote-side changes, and compare the block's
 * current state against what was last pushed to detect local-side changes.
 */
export function detectConflict(
	block: ScheduledBlock,
	remoteEvent: GoogleCalendarEvent,
	mapping: EventMapping
): SyncConflict | null {
	const remoteUpdated = new Date(remoteEvent.updated).getTime();
	const lastPush = new Date(mapping.lastLocalPush).getTime();

	// Remote wasn't touched since our last push — no conflict
	if (remoteUpdated <= lastPush) return null;

	// Build local times for comparison
	const localStart = blockToISOStart(block);
	const localEnd = blockToISOEnd(block);

	const remoteStart = remoteEvent.start.dateTime ?? remoteEvent.start.date ?? '';
	const remoteEnd = remoteEvent.end.dateTime ?? remoteEvent.end.date ?? '';

	const titleMatch = block.title === remoteEvent.summary;
	const timeMatch = localStart === remoteStart && localEnd === remoteEnd;

	// Both sides agree — no real conflict
	if (titleMatch && timeMatch) return null;

	return {
		blockId: block.id,
		googleEventId: remoteEvent.id,
		localTitle: block.title,
		remoteTitle: remoteEvent.summary,
		localTime: { start: localStart, end: localEnd },
		remoteTime: { start: remoteStart, end: remoteEnd },
	};
}

/**
 * Resolves a conflict according to the user's chosen strategy.
 *
 * When `strategy` is `'ask'`, the conflict is skipped (left for the user to
 * resolve manually via the UI).
 */
export function resolveConflict(
	_conflict: SyncConflict,
	strategy: ConflictStrategy
): ResolutionResult {
	switch (strategy) {
		case 'local-wins':
			return { winner: 'local' };
		case 'remote-wins':
			return { winner: 'remote' };
		case 'ask':
		default:
			return { winner: 'skip' };
	}
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Converts a ScheduledBlock to an ISO date-time string for its start time. */
export function blockToISOStart(block: ScheduledBlock): string {
	return blockTimeToISO(block.weekStart, block.dayIndex, block.startHour, block.startMinute);
}

/** Converts a ScheduledBlock to an ISO date-time string for its end time. */
export function blockToISOEnd(block: ScheduledBlock): string {
	const totalMinutes =
		block.startHour * 60 + block.startMinute + block.duration;
	const endHour = Math.floor(totalMinutes / 60);
	const endMinute = totalMinutes % 60;
	return blockTimeToISO(block.weekStart, block.dayIndex, endHour, endMinute);
}

/**
 * Builds an ISO 8601 date-time string from a weekStart date, day offset,
 * hour, and minute.
 */
function blockTimeToISO(
	weekStart: string,
	dayIndex: number,
	hour: number,
	minute: number
): string {
	const base = new Date(`${weekStart}T00:00:00`);
	base.setDate(base.getDate() + dayIndex);
	base.setHours(hour, minute, 0, 0);
	return base.toISOString();
}
