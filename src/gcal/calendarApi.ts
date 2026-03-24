/**
 * Google Calendar API v3 client.
 *
 * Wraps the REST endpoints we need for two-way sync: listing calendars,
 * listing/creating/updating/deleting events.  All requests go through
 * Obsidian's `requestUrl` and are wrapped with the rate-limiter / retry logic.
 */

import { requestUrl } from 'obsidian';
import type {
	OAuthTokens,
	CalendarListEntry,
	CalendarListResponse,
	GoogleCalendarEvent,
	EventListResponse,
	EventWriteBody,
} from './types';
import { isTokenExpired, refreshAccessToken } from './auth';
import { withRetry } from './rateLimiter';

const BASE_URL = 'https://www.googleapis.com/calendar/v3';

/** Callbacks for the calendar API client. */
export interface CalendarApiCallbacks {
	/** Retrieves the current OAuth tokens. */
	getTokens: () => OAuthTokens | null;
	/** Persists updated tokens after a refresh. */
	saveTokens: (tokens: OAuthTokens) => Promise<void>;
	/** The Google Cloud Console client ID. */
	clientId: string;
}

// ── Token management ──────────────────────────────────────────────────────────

/**
 * Returns a valid access token, refreshing automatically if expired.
 * Throws if no tokens are available.
 */
async function getValidAccessToken(cb: CalendarApiCallbacks): Promise<string> {
	let tokens = cb.getTokens();
	if (!tokens) {
		throw new Error('Not authenticated. Please sign in to Google Calendar.');
	}

	if (isTokenExpired(tokens)) {
		if (!tokens.refresh_token) {
			throw new Error(
				'Access token expired and no refresh token available. Please sign in again.'
			);
		}
		tokens = await refreshAccessToken(cb.clientId, tokens.refresh_token);
		await cb.saveTokens(tokens);
	}

	return tokens.access_token;
}

// ── API helpers ───────────────────────────────────────────────────────────────

interface ApiRequestOptions {
	method: string;
	path: string;
	params?: Record<string, string>;
	body?: unknown;
}

async function apiRequest<T>(
	cb: CalendarApiCallbacks,
	opts: ApiRequestOptions
): Promise<T> {
	return withRetry(async () => {
		const accessToken = await getValidAccessToken(cb);

		const url = new URL(`${BASE_URL}${opts.path}`);
		if (opts.params) {
			for (const [key, value] of Object.entries(opts.params)) {
				url.searchParams.set(key, value);
			}
		}

		const resp = await requestUrl({
			url: url.toString(),
			method: opts.method,
			headers: {
				Authorization: `Bearer ${accessToken}`,
				'Content-Type': 'application/json',
			},
			body: opts.body ? JSON.stringify(opts.body) : undefined,
		});

		return resp.json as T;
	});
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Lists all calendars the authenticated user has access to.
 * Only returns calendars where the user has at least reader access.
 */
export async function listCalendars(
	cb: CalendarApiCallbacks
): Promise<CalendarListEntry[]> {
	const entries: CalendarListEntry[] = [];
	let pageToken: string | undefined;

	do {
		const params: Record<string, string> = { maxResults: '250' };
		if (pageToken) params.pageToken = pageToken;

		const resp = await apiRequest<CalendarListResponse>(cb, {
			method: 'GET',
			path: '/users/me/calendarList',
			params,
		});

		entries.push(...resp.items);
		pageToken = resp.nextPageToken;
	} while (pageToken);

	return entries;
}

/**
 * Lists events in a calendar within a time range.
 *
 * @param calendarId - The calendar to query (use `'primary'` for the user's main calendar).
 * @param timeMin - RFC 3339 lower bound (inclusive).
 * @param timeMax - RFC 3339 upper bound (exclusive).
 */
export async function listEvents(
	cb: CalendarApiCallbacks,
	calendarId: string,
	timeMin: string,
	timeMax: string
): Promise<GoogleCalendarEvent[]> {
	const events: GoogleCalendarEvent[] = [];
	let pageToken: string | undefined;

	do {
		const params: Record<string, string> = {
			timeMin,
			timeMax,
			singleEvents: 'true', // Expand recurring events
			maxResults: '250',
			orderBy: 'startTime',
		};
		if (pageToken) params.pageToken = pageToken;

		const resp = await apiRequest<EventListResponse>(cb, {
			method: 'GET',
			path: `/calendars/${encodeURIComponent(calendarId)}/events`,
			params,
		});

		events.push(...resp.items);
		pageToken = resp.nextPageToken;
	} while (pageToken);

	return events;
}

/**
 * Creates a new event in the specified calendar.
 * Returns the created event (including its server-assigned ID).
 */
export async function createEvent(
	cb: CalendarApiCallbacks,
	calendarId: string,
	event: EventWriteBody
): Promise<GoogleCalendarEvent> {
	return apiRequest<GoogleCalendarEvent>(cb, {
		method: 'POST',
		path: `/calendars/${encodeURIComponent(calendarId)}/events`,
		body: event,
	});
}

/**
 * Updates an existing event.
 * Uses PATCH so only the supplied fields are modified.
 */
export async function updateEvent(
	cb: CalendarApiCallbacks,
	calendarId: string,
	eventId: string,
	patch: Partial<EventWriteBody>
): Promise<GoogleCalendarEvent> {
	return apiRequest<GoogleCalendarEvent>(cb, {
		method: 'PATCH',
		path: `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
		body: patch,
	});
}

/**
 * Deletes (cancels) an event from the specified calendar.
 *
 * Google Calendar returns 204 No Content on success, so we use `requestUrl`
 * directly here.
 */
export async function deleteEvent(
	cb: CalendarApiCallbacks,
	calendarId: string,
	eventId: string
): Promise<void> {
	await withRetry(async () => {
		const accessToken = await getValidAccessToken(cb);
		const url = `${BASE_URL}/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`;

		await requestUrl({
			url,
			method: 'DELETE',
			headers: { Authorization: `Bearer ${accessToken}` },
		});
	});
}
