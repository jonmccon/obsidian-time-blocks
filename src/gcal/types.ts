/**
 * Types for Google Calendar API integration.
 * These mirror the Google Calendar REST API v3 resource shapes we use.
 */

// ── OAuth 2.0 ────────────────────────────────────────────────────────────────

/** Tokens returned by the Google OAuth 2.0 token endpoint. */
export interface OAuthTokens {
	access_token: string;
	refresh_token?: string;
	expires_at: number; // Unix epoch (ms) when access_token expires
	token_type: string;
	scope: string;
}

/** Response shape from the Google OAuth token endpoint. */
export interface TokenEndpointResponse {
	access_token: string;
	expires_in: number;
	refresh_token?: string;
	scope: string;
	token_type: string;
}

// ── Calendar API Resources ───────────────────────────────────────────────────

/** Minimal CalendarListEntry from the Google Calendar API. */
export interface CalendarListEntry {
	id: string;
	summary: string;
	primary?: boolean;
	accessRole: 'freeBusyReader' | 'reader' | 'writer' | 'owner';
	backgroundColor?: string;
}

/** Google Calendar event resource (subset of fields we use). */
export interface GoogleCalendarEvent {
	id: string;
	summary: string;
	description?: string;
	location?: string;
	status: 'confirmed' | 'tentative' | 'cancelled';
	start: GoogleDateTime;
	end: GoogleDateTime;
	updated: string; // RFC 3339 timestamp
	htmlLink?: string;
}

/** Google Calendar date/time object. */
export interface GoogleDateTime {
	/** Full-day event date (YYYY-MM-DD). Present for all-day events. */
	date?: string;
	/** Precise date-time (RFC 3339). Present for timed events. */
	dateTime?: string;
	/** IANA timezone (e.g. "America/New_York"). */
	timeZone?: string;
}

/** Request body for creating / updating a Google Calendar event. */
export interface EventWriteBody {
	summary: string;
	description?: string;
	start: GoogleDateTime;
	end: GoogleDateTime;
	status?: 'confirmed' | 'tentative' | 'cancelled';
}

/** Response wrapper from a Google Calendar events.list call. */
export interface EventListResponse {
	items: GoogleCalendarEvent[];
	nextPageToken?: string;
}

/** Response wrapper from a Google Calendar calendarList.list call. */
export interface CalendarListResponse {
	items: CalendarListEntry[];
	nextPageToken?: string;
}

// ── Sync Metadata ────────────────────────────────────────────────────────────

/** Persisted mapping between a local ScheduledBlock and a remote Google event. */
export interface EventMapping {
	/** The local ScheduledBlock.id. */
	blockId: string;
	/** The Google Calendar event ID. */
	googleEventId: string;
	/** The Google Calendar ID the event lives in. */
	calendarId: string;
	/** RFC 3339 timestamp of the last known remote update. */
	lastRemoteUpdate: string;
	/** ISO timestamp of the last local change that was pushed. */
	lastLocalPush: string;
}

/** Conflict information when the same event was edited in both places. */
export interface SyncConflict {
	blockId: string;
	googleEventId: string;
	localTitle: string;
	remoteTitle: string;
	localTime: { start: string; end: string };
	remoteTime: { start: string; end: string };
}

/** User preference for automatic conflict resolution. */
export type ConflictStrategy = 'local-wins' | 'remote-wins' | 'ask';

/** Result of a single sync cycle. */
export interface SyncResult {
	created: number;
	updated: number;
	deleted: number;
	conflicts: SyncConflict[];
	errors: string[];
}
