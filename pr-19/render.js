/**
 * preview/render.js
 *
 * Self-contained DOM builder that replicates the TimeBlockView / DayView
 * HTML structure using hardcoded placeholder data.  No bundler, no Obsidian
 * required — just open index.html in any browser.
 *
 * Mirrors the constants and helpers from:
 *   src/views/TimeBlockView.ts  (HOUR_HEIGHT, DAY_HEADER_HEIGHT, renderBlock …)
 *   src/utils/weekUtils.ts      (getWeekStart, getWeekDays, formatHour …)
 */

// ── Constants (mirrors TimeBlockView.ts) ────────────────────────────────────

const HOUR_HEIGHT = 60;      // px per hour  (1 px ≈ 1 minute)
const MIN_DURATION = 15;     // minimum block height in minutes
const DAY_HEADER_HEIGHT = 44;
const WORKDAY_START = 8;     // 8 AM
const WORKDAY_END = 18;      // 6 PM

/** Priority icons matching the Tasks-plugin convention (index = priority level). */
const PRIO_ICONS = ['', '🔺', '⏫', '🔼', '🔽', '⏬'];

// ── Placeholder data ────────────────────────────────────────────────────────

/** Build a week-of-days array anchored to the current Monday. */
function getWeekStart(date) {
	const d = new Date(date);
	const day = d.getDay(); // 0=Sun
	const diff = day === 0 ? -6 : 1 - day;
	d.setDate(d.getDate() + diff);
	d.setHours(0, 0, 0, 0);
	return d;
}

function getWeekDays(weekStart) {
	return Array.from({ length: 7 }, (_, i) => {
		const d = new Date(weekStart);
		d.setDate(d.getDate() + i);
		return d;
	});
}

function formatDate(date) {
	const y = date.getFullYear();
	const m = String(date.getMonth() + 1).padStart(2, '0');
	const d = String(date.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

function formatHour(hour) {
	if (hour === 0) return '12 AM';
	if (hour < 12) return `${hour} AM`;
	if (hour === 12) return '12 PM';
	return `${hour - 12} PM`;
}

function isToday(date) {
	const t = new Date();
	return (
		date.getFullYear() === t.getFullYear() &&
		date.getMonth() === t.getMonth() &&
		date.getDate() === t.getDate()
	);
}

function formatBlockTimeLabel(block) {
	const pad = (n) => String(n).padStart(2, '0');
	const endMinutes = block.startMinute + block.duration;
	const endHour = block.startHour + Math.floor(endMinutes / 60);
	const endMin = endMinutes % 60;
	return `${pad(block.startHour)}:${pad(block.startMinute)} – ${pad(endHour)}:${pad(endMin)}`;
}

// ── Placeholder backlog tasks ────────────────────────────────────────────────

const TODAY = new Date();
const NEXT_WEEK = new Date(TODAY);
NEXT_WEEK.setDate(TODAY.getDate() + 7);
const YESTERDAY = new Date(TODAY);
YESTERDAY.setDate(TODAY.getDate() - 1);

const PLACEHOLDER_TASKS = [
	{
		id: 'task-1',
		title: 'Write project proposal',
		dueDate: NEXT_WEEK,
		priority: 1,
		tags: ['#work', '#writing'],
		completed: false,
		color: '#7c3aed',
	},
	{
		id: 'task-2',
		title: 'Review pull requests',
		dueDate: TODAY,
		priority: 2,
		tags: ['#dev'],
		completed: false,
		color: '#2563eb',
	},
	{
		id: 'task-3',
		title: 'Update documentation',
		dueDate: YESTERDAY,
		priority: 3,
		tags: ['#dev', '#writing'],
		completed: false,
		color: '#059669',
	},
	{
		id: 'task-4',
		title: 'Team standup prep',
		dueDate: null,
		priority: 4,
		tags: ['#meetings'],
		completed: true,
		color: '#d97706',
	},
];

// ── Placeholder scheduled blocks ─────────────────────────────────────────────
// dayIndex: 0=Mon … 6=Sun; weekStart is dynamically computed below.

const PLACEHOLDER_BLOCKS = [
	// Monday: deep work 9–11
	{ id: 'b1', taskId: 'task-1', title: 'Write project proposal', dayIndex: 0, startHour: 9,  startMinute: 0,  duration: 120, color: '#7c3aed', source: 'task' },
	// Monday: standup 10–10:30
	{ id: 'b2', taskId: null,     title: 'Team standup',           dayIndex: 0, startHour: 10, startMinute: 0,  duration: 30,  color: '#d97706', source: 'manual' },
	// Tuesday: PR review 9–10
	{ id: 'b3', taskId: 'task-2', title: 'Review pull requests',   dayIndex: 1, startHour: 9,  startMinute: 0,  duration: 60,  color: '#2563eb', source: 'task' },
	// Tuesday: GCal event 14–15
	{ id: 'b4', taskId: null,     title: 'Design review (GCal)',   dayIndex: 1, startHour: 14, startMinute: 0,  duration: 60,  color: '#0891b2', source: 'gcal' },
	// Wednesday: docs 11–12:30
	{ id: 'b5', taskId: 'task-3', title: 'Update documentation',   dayIndex: 2, startHour: 11, startMinute: 0,  duration: 90,  color: '#059669', source: 'task' },
	// Thursday: planning 15–16
	{ id: 'b6', taskId: null,     title: 'Sprint planning',        dayIndex: 3, startHour: 15, startMinute: 0,  duration: 60,  color: '#db2777', source: 'manual' },
	// Friday: retro 13–14
	{ id: 'b7', taskId: null,     title: 'Retrospective',          dayIndex: 4, startHour: 13, startMinute: 30, duration: 60,  color: '#7c3aed', source: 'gcal' },
];

// ── DOM helpers ─────────────────────────────────────────────────────────────

function el(tag, cls, text) {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	if (text !== undefined) e.textContent = text;
	return e;
}

function div(cls, text) { return el('div', cls, text); }
function span(cls, text) { return el('span', cls, text); }

// ── Sidebar builder ──────────────────────────────────────────────────────────

function buildSidebar(root) {
	const sidebar = div('tb-sidebar');
	root.appendChild(sidebar);

	// Header
	const header = div('tb-sidebar-header');
	header.appendChild(span('tb-sidebar-title', 'Backlog (preview)'));
	const refreshBtn = el('button', 'tb-icon-btn', '↻');
	refreshBtn.title = 'Refresh tasks (demo)';
	header.appendChild(refreshBtn);
	sidebar.appendChild(header);

	// Search
	const searchRow = div('tb-search-row');
	const input = document.createElement('input');
	input.type = 'text';
	input.className = 'tb-search-input';
	input.placeholder = 'Filter tasks…';
	searchRow.appendChild(input);
	sidebar.appendChild(searchRow);

	// Task list
	const list = div('tb-backlog-list');
	sidebar.appendChild(list);

	for (const task of PLACEHOLDER_TASKS) {
		const item = div('tb-task-item');
		item.setAttribute('draggable', 'true');
		item.dataset.taskId = task.id;
		if (task.completed) item.classList.add('tb-task-item--completed');

		// Color indicator bar
		if (task.color) {
			const indicator = div('tb-tag-color-indicator');
			indicator.style.setProperty('--tb-tag-color', task.color);
			item.appendChild(indicator);
			item.style.position = 'relative';
			item.style.paddingLeft = '11px';
		}

		const itemHeader = div('tb-task-header');

		// Checkbox
		const checkbox = document.createElement('input');
		checkbox.type = 'checkbox';
		checkbox.className = 'tb-task-complete';
		checkbox.checked = task.completed;
		itemHeader.appendChild(checkbox);

		// Priority icon
		if (task.priority !== undefined) {
			itemHeader.appendChild(span('tb-task-prio', PRIO_ICONS[task.priority] ?? ''));
		}

		// Title
		const titleLink = el('a', 'tb-task-title', task.title);
		titleLink.href = '#';
		titleLink.title = 'Open task (demo)';
		titleLink.addEventListener('click', (e) => e.preventDefault());
		itemHeader.appendChild(titleLink);
		item.appendChild(itemHeader);

		// Due date
		if (task.dueDate) {
			const dateEl = div('tb-task-due', `Due ${task.dueDate.toLocaleDateString()}`);
			const today = new Date();
			today.setHours(0, 0, 0, 0);
			const due = new Date(task.dueDate);
			due.setHours(0, 0, 0, 0);
			if (due < today) dateEl.classList.add('tb-overdue');
			item.appendChild(dateEl);
		}

		// Tags
		if (task.tags.length > 0) {
			const tagsEl = div('tb-task-tags');
			for (const tag of task.tags) {
				const tagSpan = span('tb-tag tb-tag--colored', tag);
				tagSpan.style.setProperty('--tb-tag-color', task.color);
				tagsEl.appendChild(tagSpan);
			}
			item.appendChild(tagsEl);
		}

		list.appendChild(item);
	}

	return sidebar;
}

// ── Week navigation bar ──────────────────────────────────────────────────────

function buildWeekNav(mainEl, weekStart) {
	const nav = div('tb-week-nav');
	mainEl.appendChild(nav);

	nav.appendChild(el('button', 'tb-nav-btn', '← prev'));

	const days = getWeekDays(weekStart);
	const label = days[0].toLocaleDateString(undefined, {
		month: 'long', day: 'numeric', year: 'numeric',
	});
	nav.appendChild(span('tb-week-label', `Week of ${label}`));

	nav.appendChild(el('button', 'tb-nav-btn', 'Today'));
	nav.appendChild(el('button', 'tb-nav-btn', 'Next →'));
	nav.appendChild(el('button', 'tb-nav-btn', '↻ refresh'));

	const badge = span('', '⚡ Preview mode — placeholder data');
	badge.style.cssText = 'font-size:11px;color:var(--text-muted);margin-left:auto;font-style:italic;';
	nav.appendChild(badge);
}

// ── Now-line indicator ───────────────────────────────────────────────────────

function renderNowIndicator(slotsEl) {
	const now = new Date();
	const nowMinutes = now.getHours() * 60 + now.getMinutes();
	const startMinutes = WORKDAY_START * 60;
	const endMinutes = WORKDAY_END * 60;
	if (nowMinutes < startMinutes || nowMinutes > endMinutes) return;

	const top = ((nowMinutes - startMinutes) / 60) * HOUR_HEIGHT;
	const line = div('tb-now-line');
	line.style.top = `${top}px`;
	slotsEl.appendChild(line);
}

// ── Block renderer ───────────────────────────────────────────────────────────

function renderBlock(block, slotsEl) {
	if (block.startHour < WORKDAY_START || block.startHour >= WORKDAY_END) return;

	const topPx =
		(block.startHour - WORKDAY_START) * HOUR_HEIGHT +
		(block.startMinute / 60) * HOUR_HEIGHT;
	const heightPx = Math.max((block.duration / 60) * HOUR_HEIGHT, 18);

	const blockEl = div('tb-block');
	if (block.source === 'gcal') blockEl.classList.add('tb-block--gcal');
	if (block.source === 'task') blockEl.classList.add('tb-block--task');

	blockEl.style.top = `${topPx}px`;
	blockEl.style.height = `${heightPx}px`;
	blockEl.style.backgroundColor = block.color;
	blockEl.dataset.blockId = block.id;

	const header = div('tb-block-header');

	if (block.source === 'task' && block.taskId) {
		const checkbox = document.createElement('input');
		checkbox.type = 'checkbox';
		checkbox.className = 'tb-block-complete';
		header.appendChild(checkbox);

		const titleLink = el('a', 'tb-block-title tb-block-title--link', block.title);
		titleLink.href = '#';
		titleLink.addEventListener('click', (e) => e.preventDefault());
		header.appendChild(titleLink);
	} else {
		header.appendChild(div('tb-block-title tb-block-title--static', block.title));
	}
	blockEl.appendChild(header);

	blockEl.appendChild(div('tb-block-time', formatBlockTimeLabel(block)));

	if (block.source !== 'gcal') {
		blockEl.setAttribute('draggable', 'true');

		const handle = div('tb-resize-handle');
		blockEl.appendChild(handle);

		const del = div('tb-block-delete', '×');
		del.title = 'Remove from schedule (demo)';
		blockEl.appendChild(del);
	}

	slotsEl.appendChild(blockEl);
}

// ── Weekly grid ──────────────────────────────────────────────────────────────

function buildGrid(mainEl, weekStart) {
	const gridEl = div('tb-grid');
	mainEl.appendChild(gridEl);

	const totalHours = WORKDAY_END - WORKDAY_START;
	const days = getWeekDays(weekStart);
	const weekKey = formatDate(weekStart);

	// Time-label column
	const timeCol = div('tb-time-col');
	const spacer = div('tb-time-spacer');
	spacer.style.height = `${DAY_HEADER_HEIGHT}px`;
	timeCol.appendChild(spacer);

	for (let h = WORKDAY_START; h <= WORKDAY_END; h++) {
		const label = div('tb-hour-label', formatHour(h));
		label.style.height = `${HOUR_HEIGHT}px`;
		timeCol.appendChild(label);
	}
	gridEl.appendChild(timeCol);

	// Day columns
	days.forEach((day, dayIndex) => {
		const col = div('tb-day-col');
		col.dataset.dayIndex = String(dayIndex);
		if (isToday(day)) col.classList.add('tb-today');

		// Sticky day header
		const header = div('tb-day-header');
		header.style.height = `${DAY_HEADER_HEIGHT}px`;
		header.appendChild(span('tb-day-name', day.toLocaleDateString(undefined, { weekday: 'short' })));
		header.appendChild(span('tb-day-num', String(day.getDate())));
		col.appendChild(header);

		// Slots container
		const slots = div('tb-slots');
		slots.style.height = `${(totalHours + 1) * HOUR_HEIGHT}px`;

		// Hour-grid lines
		for (let h = 0; h <= totalHours; h++) {
			const slot = div('tb-hour-slot');
			slot.style.top = `${h * HOUR_HEIGHT}px`;
			slot.style.height = `${HOUR_HEIGHT}px`;
			slots.appendChild(slot);
		}

		// Now indicator
		if (isToday(day)) renderNowIndicator(slots);

		// Render blocks for this day
		for (const block of PLACEHOLDER_BLOCKS) {
			if (block.dayIndex === dayIndex) {
				renderBlock({ ...block, weekStart: weekKey }, slots);
			}
		}

		col.appendChild(slots);
		gridEl.appendChild(col);
	});

	return gridEl;
}

// ── Root builder ─────────────────────────────────────────────────────────────

function buildPreview() {
	const weekStart = getWeekStart(new Date());

	// Attach to the #app mount point in index.html
	const app = document.getElementById('app');
	if (!app) return;

	const root = div('tb-root');
	app.appendChild(root);

	// Sidebar
	buildSidebar(root);

	// Resize handle
	const resizer = div('tb-sidebar-resizer');
	root.appendChild(resizer);

	// Main area
	const mainEl = div('tb-main');
	root.appendChild(mainEl);

	buildWeekNav(mainEl, weekStart);
	buildGrid(mainEl, weekStart);
}

// Run after DOM is ready
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', buildPreview);
} else {
	buildPreview();
}
