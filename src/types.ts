/** A block placed on the weekly time-block grid (task or manual). */
export interface ScheduledBlock {
	id: string;
	/** References a TaskItem.id when source === 'task'. */
	taskId?: string;
	/** References a GCalEvent.id when source === 'gcal'. */
	gcalEventId?: string;
	title: string;
	/** ISO date string (YYYY-MM-DD) for Monday of the target week. */
	weekStart: string;
	/** 0 = Monday … 6 = Sunday. */
	dayIndex: number;
	startHour: number;
	startMinute: number;
	/** Duration in minutes. */
	duration: number;
	color: string;
	source: 'task' | 'gcal' | 'manual';
}

/** Root data structure persisted to data.json. */
export interface TimeBlockData {
	version: number;
	blocks: ScheduledBlock[];
}

/** A task parsed from a vault markdown file (Tasks-plugin format). */
export interface TaskItem {
	/** Unique key: "<filePath>:<lineNumber>" */
	id: string;
	title: string;
	dueDate?: Date;
	/** 1 = highest … 5 = lowest */
	priority?: number;
	filePath: string;
	lineNumber: number;
	completed: boolean;
	tags: string[];
	rawText: string;
}

/** A calendar event parsed from an ICS feed. */
export interface GCalEvent {
	id: string;
	title: string;
	start: Date;
	end: Date;
	isAllDay: boolean;
	description?: string;
	location?: string;
}

/** Re-export sync-related types for convenience. */
export type {
	EventMapping,
	SyncConflict,
	SyncResult,
	ConflictStrategy,
} from './gcal/types';
