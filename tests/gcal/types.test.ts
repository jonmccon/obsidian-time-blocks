import { describe, it, expect } from 'vitest';
import type {
	OAuthTokens,
	EventMapping,
	SyncConflict,
	SyncResult,
	ConflictStrategy,
	GoogleCalendarEvent,
	EventWriteBody,
	CalendarListEntry,
	GoogleDateTime,
} from '../../src/gcal/types';

describe('OAuthTokens type shape', () => {
	it('creates a valid OAuthTokens object', () => {
		const tokens: OAuthTokens = {
			access_token: 'ya29.test',
			refresh_token: '1//test-refresh',
			expires_at: Date.now() + 3600_000,
			token_type: 'Bearer',
			scope: 'https://www.googleapis.com/auth/calendar',
		};

		expect(tokens.access_token).toBe('ya29.test');
		expect(tokens.refresh_token).toBe('1//test-refresh');
		expect(tokens.token_type).toBe('Bearer');
		expect(tokens.expires_at).toBeGreaterThan(Date.now());
	});

	it('allows optional refresh_token', () => {
		const tokens: OAuthTokens = {
			access_token: 'ya29.test',
			expires_at: Date.now() + 3600_000,
			token_type: 'Bearer',
			scope: 'https://www.googleapis.com/auth/calendar',
		};

		expect(tokens.refresh_token).toBeUndefined();
	});
});

describe('EventMapping type shape', () => {
	it('creates a valid EventMapping object', () => {
		const mapping: EventMapping = {
			blockId: 'block-1',
			googleEventId: 'abc123',
			calendarId: 'primary',
			lastRemoteUpdate: '2025-06-09T08:00:00Z',
			lastLocalPush: '2025-06-09T08:30:00Z',
		};

		expect(mapping.blockId).toBe('block-1');
		expect(mapping.googleEventId).toBe('abc123');
		expect(mapping.calendarId).toBe('primary');
	});
});

describe('SyncConflict type shape', () => {
	it('creates a valid SyncConflict object', () => {
		const conflict: SyncConflict = {
			blockId: 'block-1',
			googleEventId: 'abc123',
			localTitle: 'Local meeting',
			remoteTitle: 'Remote meeting',
			localTime: {
				start: '2025-06-09T09:00:00Z',
				end: '2025-06-09T10:00:00Z',
			},
			remoteTime: {
				start: '2025-06-09T09:30:00Z',
				end: '2025-06-09T10:30:00Z',
			},
		};

		expect(conflict.localTitle).not.toBe(conflict.remoteTitle);
	});
});

describe('SyncResult type shape', () => {
	it('creates a valid SyncResult object', () => {
		const result: SyncResult = {
			created: 2,
			updated: 1,
			deleted: 0,
			conflicts: [],
			errors: [],
		};

		expect(result.created).toBe(2);
		expect(result.updated).toBe(1);
		expect(result.errors).toHaveLength(0);
	});
});

describe('ConflictStrategy type', () => {
	it('accepts all valid values', () => {
		const strategies: ConflictStrategy[] = ['local-wins', 'remote-wins', 'ask'];
		expect(strategies).toHaveLength(3);
	});
});

describe('GoogleCalendarEvent type shape', () => {
	it('creates a timed event', () => {
		const event: GoogleCalendarEvent = {
			id: 'event-1',
			summary: 'Team standup',
			status: 'confirmed',
			start: { dateTime: '2025-06-09T09:00:00-04:00', timeZone: 'America/New_York' },
			end: { dateTime: '2025-06-09T09:30:00-04:00', timeZone: 'America/New_York' },
			updated: '2025-06-09T08:00:00Z',
		};

		expect(event.id).toBe('event-1');
		expect(event.status).toBe('confirmed');
		expect(event.start.dateTime).toContain('09:00:00');
	});

	it('creates an all-day event', () => {
		const event: GoogleCalendarEvent = {
			id: 'event-2',
			summary: 'Team offsite',
			status: 'confirmed',
			start: { date: '2025-06-15' },
			end: { date: '2025-06-16' },
			updated: '2025-06-09T08:00:00Z',
		};

		expect(event.start.date).toBe('2025-06-15');
		expect(event.start.dateTime).toBeUndefined();
	});
});

describe('EventWriteBody type shape', () => {
	it('creates a valid event write body', () => {
		const body: EventWriteBody = {
			summary: 'New event',
			start: { dateTime: '2025-06-09T14:00:00Z' },
			end: { dateTime: '2025-06-09T15:00:00Z' },
		};

		expect(body.summary).toBe('New event');
		expect(body.status).toBeUndefined();
	});

	it('supports optional fields', () => {
		const body: EventWriteBody = {
			summary: 'Updated event',
			description: 'Event description',
			start: { dateTime: '2025-06-09T14:00:00Z' },
			end: { dateTime: '2025-06-09T15:00:00Z' },
			status: 'tentative',
		};

		expect(body.description).toBe('Event description');
		expect(body.status).toBe('tentative');
	});
});

describe('CalendarListEntry type shape', () => {
	it('creates a valid calendar list entry', () => {
		const entry: CalendarListEntry = {
			id: 'user@gmail.com',
			summary: 'My Calendar',
			primary: true,
			accessRole: 'owner',
		};

		expect(entry.id).toBe('user@gmail.com');
		expect(entry.primary).toBe(true);
		expect(entry.accessRole).toBe('owner');
	});

	it('supports all access roles', () => {
		const roles: CalendarListEntry['accessRole'][] = [
			'freeBusyReader',
			'reader',
			'writer',
			'owner',
		];
		roles.forEach((role) => {
			const entry: CalendarListEntry = {
				id: 'test',
				summary: 'Test',
				accessRole: role,
			};
			expect(entry.accessRole).toBe(role);
		});
	});
});

describe('GoogleDateTime type shape', () => {
	it('can represent a timed event', () => {
		const dt: GoogleDateTime = {
			dateTime: '2025-06-09T09:00:00-04:00',
			timeZone: 'America/New_York',
		};
		expect(dt.dateTime).toBeTruthy();
		expect(dt.date).toBeUndefined();
	});

	it('can represent an all-day event', () => {
		const dt: GoogleDateTime = {
			date: '2025-06-09',
		};
		expect(dt.date).toBeTruthy();
		expect(dt.dateTime).toBeUndefined();
	});
});
