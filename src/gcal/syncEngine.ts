/**
 * Two-way sync engine for Google Calendar ↔ Obsidian Time Blocks.
 *
 * Orchestrates:
 * 1. Pushing locally-scheduled blocks to Google Calendar (create / update / delete).
 * 2. Pulling remote changes and updating local blocks.
 * 3. Detecting and resolving conflicts when both sides changed.
 * 4. Maintaining the EventMapping table that links block IDs ↔ Google event IDs.
 */

import type { ScheduledBlock } from '../types';
import type {
	ConflictStrategy,
	EventMapping,
	EventWriteBody,
	GoogleCalendarEvent,
	GoogleDateTime,
	SyncResult,
} from './types';
import type { CalendarApiCallbacks } from './calendarApi';
import {
	createEvent,
	deleteEvent,
	listEvents,
	updateEvent,
} from './calendarApi';
import {
	blockToISOEnd,
	blockToISOStart,
	detectConflict,
	resolveConflict,
} from './conflictResolver';

// ── Public interface ──────────────────────────────────────────────────────────

/** External dependencies the sync engine needs from the plugin. */
export interface SyncDeps {
	/** API callbacks for authenticated requests. */
	api: CalendarApiCallbacks;
	/** Google Calendar ID to push events into. */
	targetCalendarId: string;
	/** Conflict resolution strategy. */
	conflictStrategy: ConflictStrategy;
	/** Current set of scheduled blocks. */
	getBlocks: () => ScheduledBlock[];
	/** Replace the blocks array. */
	setBlocks: (blocks: ScheduledBlock[]) => void;
	/** Current event mappings. */
	getMappings: () => EventMapping[];
	/** Persist updated mappings. */
	saveMappings: (mappings: EventMapping[]) => Promise<void>;
}

/**
 * Runs a full two-way sync cycle for the given week.
 *
 * @param deps  External dependencies injected from the plugin.
 * @param weekStart  ISO date (YYYY-MM-DD) of the Monday of the target week.
 * @returns A summary of what happened during this sync cycle.
 */
export async function runSync(
	deps: SyncDeps,
	weekStart: string
): Promise<SyncResult> {
	const result: SyncResult = {
		created: 0,
		updated: 0,
		deleted: 0,
		conflicts: [],
		errors: [],
	};

	const blocks = deps.getBlocks();
	const mappings = [...deps.getMappings()];

	// Compute the time window for the week (Monday 00:00 → Sunday 23:59:59).
	const weekStartDate = new Date(`${weekStart}T00:00:00`);
	const weekEndDate = new Date(weekStartDate);
	weekEndDate.setDate(weekEndDate.getDate() + 7);

	const timeMin = weekStartDate.toISOString();
	const timeMax = weekEndDate.toISOString();

	// 1. Fetch remote events for this week
	let remoteEvents: GoogleCalendarEvent[];
	try {
		remoteEvents = await listEvents(
			deps.api,
			deps.targetCalendarId,
			timeMin,
			timeMax
		);
	} catch (err) {
		result.errors.push(`Failed to fetch events: ${String(err)}`);
		return result;
	}

	const remoteMap = new Map<string, GoogleCalendarEvent>();
	for (const event of remoteEvents) {
		remoteMap.set(event.id, event);
	}

	// Index mappings by blockId and by googleEventId
	const mappingByBlock = new Map<string, EventMapping>();
	const mappingByGoogle = new Map<string, EventMapping>();
	for (const m of mappings) {
		mappingByBlock.set(m.blockId, m);
		mappingByGoogle.set(m.googleEventId, m);
	}

	// Blocks for this week (only task and manual blocks — we don't push gcal blocks back)
	const weekBlocks = blocks.filter(
		(b) => b.weekStart === weekStart && b.source !== 'gcal'
	);
	const weekBlockIds = new Set(weekBlocks.map((b) => b.id));

	// 2. Push local → remote
	for (const block of weekBlocks) {
		const existing = mappingByBlock.get(block.id);

		if (!existing) {
			// New block — create remote event
			try {
				const body = blockToEventBody(block);
				const created = await createEvent(deps.api, deps.targetCalendarId, body);
				const now = new Date().toISOString();
				mappings.push({
					blockId: block.id,
					googleEventId: created.id,
					calendarId: deps.targetCalendarId,
					lastRemoteUpdate: created.updated,
					lastLocalPush: now,
				});
				result.created++;
			} catch (err) {
				result.errors.push(
					`Failed to create event for block "${block.title}": ${String(err)}`
				);
			}
			continue;
		}

		// Existing mapping — check for conflicts
		const remoteEvent = remoteMap.get(existing.googleEventId);
		if (!remoteEvent) {
			// Remote event was deleted — remove mapping
			removeMappingByBlockId(mappings, block.id);
			result.deleted++;
			continue;
		}

		const conflict = detectConflict(block, remoteEvent, existing);
		if (conflict) {
			const resolution = resolveConflict(conflict, deps.conflictStrategy);
			if (resolution.winner === 'local') {
				await pushLocalToRemote(deps, block, existing, mappings, result);
			} else if (resolution.winner === 'remote') {
				applyRemoteToLocal(block, remoteEvent, existing, mappings, result, deps);
			} else {
				result.conflicts.push(conflict);
			}
		} else {
			// No conflict — push local changes if any differ from remote
			if (hasLocalChanges(block, remoteEvent)) {
				await pushLocalToRemote(deps, block, existing, mappings, result);
			}
		}
	}

	// 3. Pull remote → local (events with mappings where the local block was deleted)
	for (const mapping of [...mappings]) {
		if (!weekBlockIds.has(mapping.blockId)) {
			// Local block was removed — delete the remote event
			try {
				await deleteEvent(deps.api, mapping.calendarId, mapping.googleEventId);
				removeMappingByBlockId(mappings, mapping.blockId);
				result.deleted++;
			} catch (err) {
				result.errors.push(
					`Failed to delete remote event ${mapping.googleEventId}: ${String(err)}`
				);
			}
		}
	}

	// 4. Status synchronization — if a remote event was cancelled, mark its
	//    linked task block for awareness (we don't auto-complete tasks, but we
	//    do track cancellation via the mapping removal).
	for (const event of remoteEvents) {
		if (event.status === 'cancelled') {
			const mapping = mappingByGoogle.get(event.id);
			if (mapping) {
				removeMappingByBlockId(mappings, mapping.blockId);
			}
		}
	}

	// 5. Persist
	await deps.saveMappings(mappings);

	return result;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function pushLocalToRemote(
	deps: SyncDeps,
	block: ScheduledBlock,
	mapping: EventMapping,
	mappings: EventMapping[],
	result: SyncResult
): Promise<void> {
	try {
		const body = blockToEventBody(block);
		const updated = await updateEvent(
			deps.api,
			mapping.calendarId,
			mapping.googleEventId,
			body
		);
		const now = new Date().toISOString();
		updateMappingTimestamps(mappings, mapping.blockId, updated.updated, now);
		result.updated++;
	} catch (err) {
		result.errors.push(
			`Failed to update event for block "${block.title}": ${String(err)}`
		);
	}
}

/** Milliseconds in one day. */
const MS_PER_DAY = 24 * 60 * 60 * 1000;

function applyRemoteToLocal(
	block: ScheduledBlock,
	remoteEvent: GoogleCalendarEvent,
	mapping: EventMapping,
	mappings: EventMapping[],
	result: SyncResult,
	deps: SyncDeps
): void {
	const start = parseGoogleDateTime(remoteEvent.start);
	const end = parseGoogleDateTime(remoteEvent.end);

	if (start && end) {
		const weekStartDate = new Date(`${block.weekStart}T00:00:00`);

		const updatedBlock: ScheduledBlock = {
			...block,
			title: remoteEvent.summary,
			dayIndex: Math.floor(
				(start.getTime() - weekStartDate.getTime()) / MS_PER_DAY
			),
			startHour: start.getHours(),
			startMinute: start.getMinutes(),
			duration: Math.round(
				(end.getTime() - start.getTime()) / 60_000
			),
		};

		// Update the blocks array in the plugin
		const blocks = deps.getBlocks();
		const idx = blocks.findIndex((b) => b.id === block.id);
		if (idx !== -1) {
			blocks[idx] = updatedBlock;
			deps.setBlocks(blocks);
		}

		const now = new Date().toISOString();
		updateMappingTimestamps(mappings, mapping.blockId, remoteEvent.updated, now);
		result.updated++;
	}
}

/** Converts a ScheduledBlock to a Google Calendar event write body. */
function blockToEventBody(block: ScheduledBlock): EventWriteBody {
	const startISO = blockToISOStart(block);
	const endISO = blockToISOEnd(block);

	const start: GoogleDateTime = { dateTime: startISO };
	const end: GoogleDateTime = { dateTime: endISO };

	return {
		summary: block.title,
		start,
		end,
	};
}

/** Returns true when the local block differs from the remote event. */
function hasLocalChanges(
	block: ScheduledBlock,
	remote: GoogleCalendarEvent
): boolean {
	if (block.title !== remote.summary) return true;

	const localStart = blockToISOStart(block);
	const localEnd = blockToISOEnd(block);

	const remoteStart = remote.start.dateTime ?? remote.start.date ?? '';
	const remoteEnd = remote.end.dateTime ?? remote.end.date ?? '';

	return localStart !== remoteStart || localEnd !== remoteEnd;
}

/** Parses a Google DateTime into a JS Date, or null if unparseable. */
function parseGoogleDateTime(dt: GoogleDateTime): Date | null {
	if (dt.dateTime) return new Date(dt.dateTime);
	if (dt.date) return new Date(`${dt.date}T00:00:00`);
	return null;
}

/** Removes a mapping by blockId (in-place). */
function removeMappingByBlockId(mappings: EventMapping[], blockId: string): void {
	const idx = mappings.findIndex((m) => m.blockId === blockId);
	if (idx !== -1) mappings.splice(idx, 1);
}

/** Updates timestamps on a mapping (in-place). */
function updateMappingTimestamps(
	mappings: EventMapping[],
	blockId: string,
	lastRemoteUpdate: string,
	lastLocalPush: string
): void {
	const mapping = mappings.find((m) => m.blockId === blockId);
	if (mapping) {
		mapping.lastRemoteUpdate = lastRemoteUpdate;
		mapping.lastLocalPush = lastLocalPush;
	}
}
