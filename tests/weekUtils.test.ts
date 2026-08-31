import { describe, it, expect } from 'vitest';
import {
	getWeekStart,
	getWeekDays,
	formatDate,
	isToday,
	addWeeks,
	formatHour,
	findNextAvailableHour,
} from '../src/utils/weekUtils';

describe('getWeekStart', () => {
	it('returns Monday for a Wednesday', () => {
		// 2025-06-11 is a Wednesday
		const wed = new Date(2025, 5, 11);
		const monday = getWeekStart(wed);
		expect(monday.getDay()).toBe(1); // Monday
		expect(monday.getFullYear()).toBe(2025);
		expect(monday.getMonth()).toBe(5);
		expect(monday.getDate()).toBe(9);
	});

	it('returns the same day when given a Monday', () => {
		const mon = new Date(2025, 5, 9);
		const result = getWeekStart(mon);
		expect(result.getDate()).toBe(9);
		expect(result.getDay()).toBe(1);
	});

	it('returns Monday of previous week when given a Sunday', () => {
		// 2025-06-15 is a Sunday
		const sun = new Date(2025, 5, 15);
		const result = getWeekStart(sun);
		expect(result.getDate()).toBe(9); // Monday June 9
		expect(result.getDay()).toBe(1);
	});

	it('returns Monday for a Saturday', () => {
		// 2025-06-14 is a Saturday
		const sat = new Date(2025, 5, 14);
		const result = getWeekStart(sat);
		expect(result.getDate()).toBe(9);
	});

	it('zeros out the time component', () => {
		const d = new Date(2025, 5, 11, 15, 30, 45);
		const result = getWeekStart(d);
		expect(result.getHours()).toBe(0);
		expect(result.getMinutes()).toBe(0);
		expect(result.getSeconds()).toBe(0);
		expect(result.getMilliseconds()).toBe(0);
	});

	it('handles year boundaries', () => {
		// 2025-01-01 is a Wednesday
		const newYear = new Date(2025, 0, 1);
		const result = getWeekStart(newYear);
		// Monday December 30, 2024
		expect(result.getFullYear()).toBe(2024);
		expect(result.getMonth()).toBe(11);
		expect(result.getDate()).toBe(30);
	});
});

describe('getWeekDays', () => {
	it('returns 7 days starting from the given Monday', () => {
		const monday = new Date(2025, 5, 9);
		const days = getWeekDays(monday);
		expect(days).toHaveLength(7);
		expect(days[0].getDate()).toBe(9);  // Mon
		expect(days[1].getDate()).toBe(10); // Tue
		expect(days[2].getDate()).toBe(11); // Wed
		expect(days[3].getDate()).toBe(12); // Thu
		expect(days[4].getDate()).toBe(13); // Fri
		expect(days[5].getDate()).toBe(14); // Sat
		expect(days[6].getDate()).toBe(15); // Sun
	});

	it('handles month boundaries', () => {
		// 2025-06-30 is a Monday
		const monday = new Date(2025, 5, 30);
		const days = getWeekDays(monday);
		expect(days[0].getMonth()).toBe(5); // June
		expect(days[1].getMonth()).toBe(6); // July 1
		expect(days[1].getDate()).toBe(1);
	});
});

describe('formatDate', () => {
	it('formats as YYYY-MM-DD', () => {
		expect(formatDate(new Date(2025, 0, 5))).toBe('2025-01-05');
		expect(formatDate(new Date(2025, 11, 25))).toBe('2025-12-25');
	});

	it('zero-pads month and day', () => {
		expect(formatDate(new Date(2025, 0, 1))).toBe('2025-01-01');
		expect(formatDate(new Date(2025, 8, 9))).toBe('2025-09-09');
	});
});

describe('isToday', () => {
	it('returns true for today', () => {
		expect(isToday(new Date())).toBe(true);
	});

	it('returns false for yesterday', () => {
		const yesterday = new Date();
		yesterday.setDate(yesterday.getDate() - 1);
		expect(isToday(yesterday)).toBe(false);
	});

	it('returns false for tomorrow', () => {
		const tomorrow = new Date();
		tomorrow.setDate(tomorrow.getDate() + 1);
		expect(isToday(tomorrow)).toBe(false);
	});
});

describe('addWeeks', () => {
	it('adds one week', () => {
		const start = new Date(2025, 5, 9);
		const result = addWeeks(start, 1);
		expect(result.getDate()).toBe(16);
		expect(result.getMonth()).toBe(5);
	});

	it('subtracts one week with negative value', () => {
		const start = new Date(2025, 5, 9);
		const result = addWeeks(start, -1);
		expect(result.getDate()).toBe(2);
		expect(result.getMonth()).toBe(5);
	});

	it('handles multiple weeks', () => {
		const start = new Date(2025, 0, 6); // Jan 6
		const result = addWeeks(start, 4);
		expect(result.getDate()).toBe(3); // Feb 3
		expect(result.getMonth()).toBe(1);
	});

	it('does not mutate the original date', () => {
		const start = new Date(2025, 5, 9);
		addWeeks(start, 3);
		expect(start.getDate()).toBe(9);
	});
});

describe('formatHour', () => {
	it('formats midnight as 12 AM', () => {
		expect(formatHour(0)).toBe('12 AM');
	});

	it('formats morning hours', () => {
		expect(formatHour(1)).toBe('1 AM');
		expect(formatHour(9)).toBe('9 AM');
		expect(formatHour(11)).toBe('11 AM');
	});

	it('formats noon as 12 PM', () => {
		expect(formatHour(12)).toBe('12 PM');
	});

	it('formats afternoon/evening hours', () => {
		expect(formatHour(13)).toBe('1 PM');
		expect(formatHour(17)).toBe('5 PM');
		expect(formatHour(23)).toBe('11 PM');
	});
});

describe('findNextAvailableHour', () => {
	it('returns the starting hour when nothing is taken', () => {
		expect(findNextAvailableHour(new Set(), 9, 18)).toBe(9);
	});

	it('skips a single taken hour', () => {
		expect(findNextAvailableHour(new Set([9]), 9, 18)).toBe(10);
	});

	it('skips multiple consecutive taken hours', () => {
		expect(findNextAvailableHour(new Set([9, 10, 11]), 9, 18)).toBe(12);
	});

	it('ignores taken hours outside the search range', () => {
		// Hour 8 is taken but the search starts at 9, so it's irrelevant.
		expect(findNextAvailableHour(new Set([8]), 9, 18)).toBe(9);
	});

	it('falls back to the starting hour when the whole range is taken', () => {
		const taken = new Set([9, 10, 11, 12, 13, 14, 15, 16, 17]);
		expect(findNextAvailableHour(taken, 9, 18)).toBe(9);
	});

	it('does not mutate the takenHours set', () => {
		const taken = new Set([9]);
		findNextAvailableHour(taken, 9, 18);
		expect(taken).toEqual(new Set([9]));
	});
});
