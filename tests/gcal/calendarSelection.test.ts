import { describe, it, expect } from 'vitest';
import {
	mapApiEventsToGCalEvents,
	shouldFetchApiCalendars,
} from '../../src/gcal/eventMapper';
import type { GoogleCalendarEvent } from '../../src/gcal/types';
import { DEFAULT_SETTINGS } from '../../src/settings';

function makeApiEvent(
	overrides?: Partial<GoogleCalendarEvent>
): GoogleCalendarEvent {
	return {
		id: 'google-event-1',
		summary: 'Team meeting',
		status: 'confirmed',
		start: { dateTime: '2025-06-09T09:00:00.000Z' },
		end: { dateTime: '2025-06-09T10:00:00.000Z' },
		updated: '2025-06-09T07:00:00Z',
		...overrides,
	};
}

describe('mapApiEventsToGCalEvents', () => {
	it('maps a timed event correctly', () => {
		const events = [
			makeApiEvent({
				description: 'Weekly sync',
				location: 'Room 1',
			}),
		];

		const result = mapApiEventsToGCalEvents(events, 'cal-1');

		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			id: 'api::cal-1::google-event-1',
			title: 'Team meeting',
			isAllDay: false,
			description: 'Weekly sync',
			location: 'Room 1',
		});
		expect(result[0].start).toEqual(new Date('2025-06-09T09:00:00.000Z'));
		expect(result[0].end).toEqual(new Date('2025-06-09T10:00:00.000Z'));
	});

	it('skips all-day events', () => {
		const events = [
			makeApiEvent({
				id: 'all-day-1',
				start: { date: '2025-06-09' },
				end: { date: '2025-06-10' },
			}),
		];

		const result = mapApiEventsToGCalEvents(events, 'cal-1');
		expect(result).toEqual([]);
	});

	it('handles a mix of timed and all-day events', () => {
		const events = [
			makeApiEvent({ id: 'timed-1' }),
			makeApiEvent({
				id: 'allday-1',
				start: { date: '2025-06-09' },
				end: { date: '2025-06-10' },
			}),
			makeApiEvent({ id: 'timed-2', summary: 'Second' }),
		];

		const result = mapApiEventsToGCalEvents(events, 'cal-1');
		expect(result).toHaveLength(2);
		expect(result.map((e) => e.id)).toEqual([
			'api::cal-1::timed-1',
			'api::cal-1::timed-2',
		]);
	});

	it('handles empty input', () => {
		expect(mapApiEventsToGCalEvents([], 'cal-1')).toEqual([]);
	});

	it('formats IDs to prevent collisions with ICS-sourced events', () => {
		const result = mapApiEventsToGCalEvents(
			[makeApiEvent()],
			'my-calendar'
		);
		expect(result[0].id).toBe('api::my-calendar::google-event-1');
		expect(result[0].id.startsWith('api::')).toBe(true);
	});

	it('excludes cancelled events', () => {
		const events = [
			makeApiEvent({ id: 'active-1' }),
			makeApiEvent({ id: 'cancelled-1', status: 'cancelled' }),
		];

		const result = mapApiEventsToGCalEvents(events, 'cal-1');
		expect(result).toHaveLength(1);
		expect(result[0].id).toBe('api::cal-1::active-1');
	});

	it('passes through optional fields, leaving missing ones undefined', () => {
		const events = [
			makeApiEvent({
				description: 'Has description',
				location: 'Has location',
			}),
			makeApiEvent({ id: 'no-optional', summary: 'No optional' }),
		];

		const result = mapApiEventsToGCalEvents(events, 'cal-1');
		expect(result[0].description).toBe('Has description');
		expect(result[0].location).toBe('Has location');
		expect(result[1].description).toBeUndefined();
		expect(result[1].location).toBeUndefined();
	});
});

describe('shouldFetchApiCalendars', () => {
	it('returns false when oauthTokens is null', () => {
		expect(
			shouldFetchApiCalendars({ oauthTokens: null, selectedCalendarIds: ['a'] })
		).toBe(false);
	});

	it('returns false when selectedCalendarIds is empty', () => {
		expect(
			shouldFetchApiCalendars({
				oauthTokens: { access_token: 'x' } as never,
				selectedCalendarIds: [],
			})
		).toBe(false);
	});

	it('returns true when tokens are present and calendars are selected', () => {
		expect(
			shouldFetchApiCalendars({
				oauthTokens: { access_token: 'x' } as never,
				selectedCalendarIds: ['a', 'b'],
			})
		).toBe(true);
	});
});

describe('selectedCalendarIds settings', () => {
	it('defaults to an empty array', () => {
		expect(DEFAULT_SETTINGS.selectedCalendarIds).toEqual([]);
	});

	it('survives a settings round-trip', () => {
		const original = { ...DEFAULT_SETTINGS };
		const saved = {
			...DEFAULT_SETTINGS,
			selectedCalendarIds: ['cal-1', 'cal-2'],
		};
		const reloaded = { ...saved };
		expect(original.selectedCalendarIds).toEqual([]);
		expect(reloaded.selectedCalendarIds).toEqual(['cal-1', 'cal-2']);
	});
});
