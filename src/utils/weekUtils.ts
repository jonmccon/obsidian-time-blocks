/**
 * Returns the Monday of the week containing `date` (time zeroed out).
 */
export function getWeekStart(date: Date): Date {
	const d = new Date(date);
	const day = d.getDay(); // 0=Sun, 1=Mon … 6=Sat
	const diff = day === 0 ? -6 : 1 - day;
	d.setDate(d.getDate() + diff);
	d.setHours(0, 0, 0, 0);
	return d;
}

/**
 * Returns an array of 7 Date objects (Mon … Sun) for the week starting at `weekStart`.
 */
export function getWeekDays(weekStart: Date): Date[] {
	return Array.from({ length: 7 }, (_, i) => {
		const d = new Date(weekStart);
		d.setDate(d.getDate() + i);
		return d;
	});
}

/** Formats a Date as an ISO date string (YYYY-MM-DD, local time). */
export function formatDate(date: Date): string {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

/** Returns true when `date` falls on today. */
export function isToday(date: Date): boolean {
	const today = new Date();
	return (
		date.getFullYear() === today.getFullYear() &&
		date.getMonth() === today.getMonth() &&
		date.getDate() === today.getDate()
	);
}

/** Advances `date` by `weeks` weeks (negative to go back). */
export function addWeeks(date: Date, weeks: number): Date {
	const d = new Date(date);
	d.setDate(d.getDate() + weeks * 7);
	return d;
}

/**
 * Formats a 24-hour number as a human-readable hour label (e.g. 9 → "9 AM", 13 → "1 PM").
 */
export function formatHour(hour: number): string {
	if (hour === 0) return '12 AM';
	if (hour < 12) return `${hour} AM`;
	if (hour === 12) return '12 PM';
	return `${hour - 12} PM`;
}
