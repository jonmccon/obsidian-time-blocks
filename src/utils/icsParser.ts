import { GCalEvent } from '../types';

/**
 * Un-folds ICS continuation lines (CRLF + SPACE/TAB → joined) and splits into
 * individual property lines.
 */
function unfoldLines(icsText: string): string[] {
	return icsText
		.replace(/\r\n[ \t]/g, '')
		.replace(/\n[ \t]/g, '')
		.split(/\r?\n/);
}

/**
 * Parses an ICS date/datetime string into a JavaScript Date.
 *
 * Supported formats:
 *   - `20240115`              → all-day (local midnight)
 *   - `20240115T090000Z`      → UTC datetime
 *   - `20240115T090000`       → floating local datetime
 *
 * TZID-based offsets are not resolved (treated as local time); for the
 * purpose of weekly scheduling this is an acceptable approximation.
 */
function parseICSDate(value: string): Date | null {
	// All-day: YYYYMMDD
	if (/^\d{8}$/.test(value)) {
		const y = parseInt(value.slice(0, 4), 10);
		const mo = parseInt(value.slice(4, 6), 10) - 1;
		const d = parseInt(value.slice(6, 8), 10);
		return new Date(y, mo, d);
	}

	// UTC: YYYYMMDDTHHmmssZ
	if (/^\d{8}T\d{6}Z$/.test(value)) {
		return new Date(
			`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` +
			`T${value.slice(9, 11)}:${value.slice(11, 13)}:${value.slice(13, 15)}Z`
		);
	}

	// Floating (local): YYYYMMDDTHHmmss
	if (/^\d{8}T\d{6}$/.test(value)) {
		const y = parseInt(value.slice(0, 4), 10);
		const mo = parseInt(value.slice(4, 6), 10) - 1;
		const d = parseInt(value.slice(6, 8), 10);
		const h = parseInt(value.slice(9, 11), 10);
		const mi = parseInt(value.slice(11, 13), 10);
		const s = parseInt(value.slice(13, 15), 10);
		return new Date(y, mo, d, h, mi, s);
	}

	return null;
}

/** Decodes common ICS text escapes. */
function decodeICSText(value: string): string {
	return value
		.replace(/\\n/g, '\n')
		.replace(/\\,/g, ',')
		.replace(/\\;/g, ';')
		.replace(/\\\\/g, '\\');
}

/**
 * Parses an ICS (iCalendar) text and returns a flat list of GCalEvent objects.
 * Only VEVENT components are processed; recurring events are included once
 * (the RRULE is not expanded).
 */
export function parseICS(icsText: string): GCalEvent[] {
	const events: GCalEvent[] = [];
	const lines = unfoldLines(icsText);

	let inEvent = false;
	let uid = '';
	let summary = '';
	let dtstart = '';
	let dtend = '';
	let description = '';
	let location = '';
	let dtStartIsDate = false;

	for (const line of lines) {
		const trimmed = line.trim();

		if (trimmed === 'BEGIN:VEVENT') {
			inEvent = true;
			uid = '';
			summary = '';
			dtstart = '';
			dtend = '';
			description = '';
			location = '';
			dtStartIsDate = false;
			continue;
		}

		if (trimmed === 'END:VEVENT') {
			inEvent = false;
			if (uid && dtstart) {
				const start = parseICSDate(dtstart);
				let end = dtend ? parseICSDate(dtend) : null;

				if (start) {
					if (!end) {
						end = new Date(start);
						if (!dtStartIsDate) end.setHours(end.getHours() + 1);
						else end.setDate(end.getDate() + 1);
					}

					events.push({
						id: uid,
						title: summary || '(No title)',
						start,
						end,
						isAllDay: dtStartIsDate,
						description: description || undefined,
						location: location || undefined,
					});
				}
			}
			continue;
		}

		if (!inEvent) continue;

		// Split on first colon only (values may contain colons)
		const colonIdx = line.indexOf(':');
		if (colonIdx === -1) continue;
		const key = line.slice(0, colonIdx).toUpperCase();
		const value = line.slice(colonIdx + 1);

		if (key === 'UID') {
			uid = value.trim();
		} else if (key.startsWith('DTSTART')) {
			dtStartIsDate = key.includes('VALUE=DATE') && !key.includes('DATE-TIME');
			dtstart = value.trim();
		} else if (key.startsWith('DTEND')) {
			dtend = value.trim();
		} else if (key === 'SUMMARY') {
			summary = decodeICSText(value);
		} else if (key === 'DESCRIPTION') {
			description = decodeICSText(value);
		} else if (key === 'LOCATION') {
			location = decodeICSText(value);
		}
	}

	return events;
}
