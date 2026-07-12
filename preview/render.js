/**
 * preview/render.js
 *
 * Self-contained DOM builder that replicates the TimeBlockView / DayView
 * HTML structure with a fully interactive in-memory store.  All state is
 * persisted to localStorage (key: "time-blocks-preview") so changes survive
 * page refreshes.  No bundler, no Obsidian required — open index.html in
 * any browser.
 *
 * Mirrors the constants and helpers from:
 *   src/views/TimeBlockView.ts  (HOUR_HEIGHT, DAY_HEADER_HEIGHT, renderBlock …)
 *   src/utils/weekUtils.ts      (getWeekStart, getWeekDays, formatHour …)
 */

// ── Constants (mirrors TimeBlockView.ts) ────────────────────────────────────

const HOUR_HEIGHT = 60;        // px per hour  (1 px ≈ 1 minute)
const MIN_DURATION = 15;       // minimum block duration in minutes
const DAY_HEADER_HEIGHT = 44;
const WORKDAY_START = 8;       // 8 AM
const WORKDAY_END = 18;        // 6 PM
const STORAGE_KEY = 'time-blocks-preview';

/** Priority icons matching the Tasks-plugin convention (index = priority level). */
const PRIO_ICONS = ['', '🔺', '⏫', '🔼', '🔽', '⏬'];

/**
 * Snap `minutes` to the nearest MIN_DURATION boundary.
 * Used for both absolute drop positions and resize deltas.
 */
function snapToGrid(minutes) {
	return Math.round(minutes / MIN_DURATION) * MIN_DURATION;
}

// ── Date utilities ───────────────────────────────────────────────────────────

function getWeekStart(date) {
	const d = new Date(date);
	const day = d.getDay(); // 0 = Sun
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

/** Returns an ISO date string (YYYY-MM-DD) offset by `days` from today. */
function isoDate(offsetDays) {
	const d = new Date();
	d.setDate(d.getDate() + offsetDays);
	return formatDate(d);
}

/** Returns a new Date `n` weeks ahead of `date`. */
function addWeeks(date, n) {
	const d = new Date(date);
	d.setDate(d.getDate() + n * 7);
	return d;
}

// ── Default placeholder data ─────────────────────────────────────────────────
// Dates are ISO strings so they survive JSON round-trips through localStorage.

const DEFAULT_TASKS = [
	// Scheduled tasks (have blocks in DEFAULT_BLOCKS_RAW)
	{ id: 'task-1', title: 'Write project proposal', dueDate: isoDate(7),  priority: 1, tags: ['#work', '#writing'],          completed: false, color: '#7c3aed' },
	{ id: 'task-2', title: 'Review pull requests',   dueDate: isoDate(0),  priority: 2, tags: ['#dev'],                       completed: false, color: '#2563eb' },
	{ id: 'task-3', title: 'Update documentation',   dueDate: isoDate(-1), priority: 3, tags: ['#dev', '#writing'],           completed: false, color: '#059669' },
	// Completed task
	{ id: 'task-4', title: 'Team standup prep',       dueDate: null,        priority: 4, tags: ['#meetings'],                  completed: true,  color: '#d97706' },
	// Unscheduled backlog tasks — these appear in the sidebar for drag-and-drop
	{ id: 'task-5', title: 'Refactor auth module',    dueDate: isoDate(3),  priority: 1, tags: ['#dev', '#backend'],           completed: false, color: '#dc2626' },
	{ id: 'task-6', title: 'Write release notes',     dueDate: isoDate(5),  priority: 2, tags: ['#writing'],                   completed: false, color: '#7c3aed' },
	{ id: 'task-7', title: 'Fix login page bug',      dueDate: isoDate(1),  priority: 1, tags: ['#dev', '#bug'],               completed: false, color: '#dc2626' },
	{ id: 'task-8', title: 'UX review meeting',       dueDate: isoDate(4),  priority: 3, tags: ['#meetings', '#design'],       completed: false, color: '#0891b2' },
	{ id: 'task-9', title: 'Update dependencies',     dueDate: isoDate(6),  priority: 4, tags: ['#dev'],                       completed: false, color: '#059669' },
	{ id: 'task-10', title: 'Onboard new teammate',   dueDate: isoDate(7),  priority: 2, tags: ['#work', '#meetings'],         completed: false, color: '#d97706' },
	{ id: 'task-11', title: 'Q3 goals retrospective', dueDate: isoDate(14), priority: 3, tags: ['#meetings'],                  completed: false, color: '#db2777' },
	{ id: 'task-12', title: 'Code review checklist',  dueDate: null,        priority: 3, tags: ['#dev', '#writing'],           completed: false, color: '#2563eb' },
	{ id: 'task-13', title: 'Set up staging env',     dueDate: isoDate(10), priority: 2, tags: ['#dev', '#backend'],           completed: false, color: '#059669' },
	{ id: 'task-14', title: 'Customer feedback call', dueDate: isoDate(2),  priority: 2, tags: ['#meetings', '#work'],         completed: false, color: '#0891b2' },
	{ id: 'task-15', title: 'Design system audit',    dueDate: isoDate(9),  priority: 4, tags: ['#design'],                   completed: false, color: '#db2777' },
];

// weekStart is injected at load time (current week's Monday).
const DEFAULT_BLOCKS_RAW = [
	// Monday: deep work 9–11
	{ id: 'b1', taskId: 'task-1', title: 'Write project proposal', dayIndex: 0, startHour: 9,  startMinute: 0,  duration: 120, color: '#7c3aed', source: 'task'   },
	// Monday: standup 10–10:30
	{ id: 'b2', taskId: null,     title: 'Team standup',           dayIndex: 0, startHour: 10, startMinute: 0,  duration: 30,  color: '#d97706', source: 'manual' },
	// Tuesday: PR review 9–10
	{ id: 'b3', taskId: 'task-2', title: 'Review pull requests',   dayIndex: 1, startHour: 9,  startMinute: 0,  duration: 60,  color: '#2563eb', source: 'task'   },
	// Tuesday: GCal event 14–15
	{ id: 'b4', taskId: null,     title: 'Design review (GCal)',   dayIndex: 1, startHour: 14, startMinute: 0,  duration: 60,  color: '#0891b2', source: 'gcal'   },
	// Wednesday: docs 11–12:30
	{ id: 'b5', taskId: 'task-3', title: 'Update documentation',   dayIndex: 2, startHour: 11, startMinute: 0,  duration: 90,  color: '#059669', source: 'task'   },
	// Thursday: planning 15–16
	{ id: 'b6', taskId: null,     title: 'Sprint planning',        dayIndex: 3, startHour: 15, startMinute: 0,  duration: 60,  color: '#db2777', source: 'manual' },
	// Friday: retro 13:30–14:30
	{ id: 'b7', taskId: null,     title: 'Retrospective',          dayIndex: 4, startHour: 13, startMinute: 30, duration: 60,  color: '#7c3aed', source: 'gcal'   },
];

// ── In-memory store with localStorage persistence ────────────────────────────

const store = {
	tasks: [],
	blocks: [],
	/** Number of weeks offset from the current week (negative = past). */
	weekOffset: 0,

	/** Load from localStorage, or seed from defaults. */
	load() {
		try {
			const raw = localStorage.getItem(STORAGE_KEY);
			if (raw) {
				const data = JSON.parse(raw);
				if (Array.isArray(data.tasks) && Array.isArray(data.blocks)) {
					this.tasks = data.tasks;
					this.blocks = data.blocks;
					this.weekOffset = typeof data.weekOffset === 'number' ? data.weekOffset : 0;
					return;
				}
			}
		} catch (_) { /* fall through to defaults */ }

		// Seed defaults — stamp blocks with the current week's Monday.
		const weekKey = formatDate(getWeekStart(new Date()));
		this.tasks = JSON.parse(JSON.stringify(DEFAULT_TASKS));
		this.blocks = DEFAULT_BLOCKS_RAW.map((b) => ({ ...b, weekStart: weekKey }));
		this.weekOffset = 0;
	},

	/** Persist current state to localStorage. */
	save() {
		try {
			localStorage.setItem(STORAGE_KEY, JSON.stringify({
				tasks: this.tasks,
				blocks: this.blocks,
				weekOffset: this.weekOffset,
			}));
		} catch (_) { /* storage full or unavailable */ }
	},

	/** Clear localStorage and reload the page. */
	reset() {
		try { localStorage.removeItem(STORAGE_KEY); } catch (_) {}
		location.reload();
	},

	/** Returns the Monday Date for the currently-viewed week. */
	currentWeekStart() {
		return addWeeks(getWeekStart(new Date()), this.weekOffset);
	},

	/** Generate a unique block ID. */
	newBlockId() {
		return `block-preview-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
	},
};

// ── Drag state ───────────────────────────────────────────────────────────────

let draggingTaskId = null;
let draggingBlockId = null;

// ── DOM helpers ──────────────────────────────────────────────────────────────

function el(tag, cls, text) {
	const e = document.createElement(tag);
	if (cls) e.className = cls;
	if (text !== undefined) e.textContent = text;
	return e;
}

function div(cls, text) { return el('div', cls, text); }
function span(cls, text) { return el('span', cls, text); }

// ── Top-level layout references ──────────────────────────────────────────────
// Set once by buildPreview(); used by rerenderMain() and renderBacklogList().

let sidebarEl = null;
let backlogListEl = null;
let searchInputEl = null;
let mainEl = null;

/** Re-render the week nav + grid without touching the sidebar. */
function rerenderMain() {
	mainEl.innerHTML = '';
	const weekStart = store.currentWeekStart();
	buildWeekNav(weekStart);
	buildGrid(weekStart);
}

// ── Sidebar ──────────────────────────────────────────────────────────────────

function buildSidebar(root) {
	sidebarEl = div('tb-sidebar');
	root.appendChild(sidebarEl);

	// Header
	const header = div('tb-sidebar-header');
	header.appendChild(span('tb-sidebar-title', 'Backlog'));
	const refreshBtn = el('button', 'tb-icon-btn', '↻');
	refreshBtn.title = 'Refresh task list';
	refreshBtn.addEventListener('click', () => renderBacklogList());
	header.appendChild(refreshBtn);
	sidebarEl.appendChild(header);

	// Search
	const searchRow = div('tb-search-row');
	searchInputEl = document.createElement('input');
	searchInputEl.type = 'text';
	searchInputEl.className = 'tb-search-input';
	searchInputEl.placeholder = 'Filter tasks…';
	searchInputEl.addEventListener('input', () => renderBacklogList());
	searchRow.appendChild(searchInputEl);
	sidebarEl.appendChild(searchRow);

	// Scrollable task list
	backlogListEl = div('tb-backlog-list');
	sidebarEl.appendChild(backlogListEl);

	renderBacklogList();
}

/**
 * Re-renders only the backlog list inside the sidebar.
 * Hides tasks that already have a block in the current week.
 */
function renderBacklogList() {
	backlogListEl.innerHTML = '';

	const query = (searchInputEl?.value ?? '').toLowerCase();
	const weekKey = formatDate(store.currentWeekStart());

	// Tasks that already have a block this week are hidden from the backlog.
	const scheduledThisWeek = new Set(
		store.blocks
			.filter((b) => b.weekStart === weekKey && b.taskId)
			.map((b) => b.taskId)
	);

	const visible = store.tasks.filter((t) => {
		if (scheduledThisWeek.has(t.id)) return false;
		if (!query) return true;
		return (
			t.title.toLowerCase().includes(query) ||
			t.tags.some((tag) => tag.toLowerCase().includes(query))
		);
	});

	if (visible.length === 0) {
		const msg = div(
			'tb-empty-msg',
			query ? 'No matching tasks.' : 'All tasks are scheduled this week.'
		);
		backlogListEl.appendChild(msg);
		return;
	}

	for (const task of visible) {
		buildTaskItem(task);
	}
}

function buildTaskItem(task) {
	const item = div('tb-task-item');
	item.setAttribute('draggable', 'true');
	item.dataset.taskId = task.id;
	item.title = 'Drag onto the grid to schedule';
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

	// Checkbox — disabled in preview; vault writes require Obsidian
	const checkbox = document.createElement('input');
	checkbox.type = 'checkbox';
	checkbox.className = 'tb-task-complete';
	checkbox.checked = task.completed;
	checkbox.disabled = true;
	checkbox.setAttribute('aria-label', 'Task completion requires Obsidian (not available in preview)');
	checkbox.title = 'Task completion requires Obsidian (not available in preview)';
	itemHeader.appendChild(checkbox);

	// Priority icon
	if (task.priority !== undefined) {
		itemHeader.appendChild(span('tb-task-prio', PRIO_ICONS[task.priority] ?? ''));
	}

	// Title link
	const titleLink = el('a', 'tb-task-title', task.title);
	titleLink.href = '#';
	titleLink.title = 'Opens task file in Obsidian (not available in preview)';
	titleLink.addEventListener('click', (e) => e.preventDefault());
	itemHeader.appendChild(titleLink);
	item.appendChild(itemHeader);

	// Due date
	if (task.dueDate) {
		// Append T00:00:00 so the date is parsed as local midnight rather than
		// UTC midnight, which would shift the displayed date by ±1 day in most
		// timezones when only the date portion is stored.
		const due = new Date(task.dueDate + 'T00:00:00');
		const dateEl = div('tb-task-due', `Due ${due.toLocaleDateString()}`);
		const today = new Date();
		today.setHours(0, 0, 0, 0);
		if (due < today) dateEl.classList.add('tb-overdue');
		item.appendChild(dateEl);
	}

	// Tags
	if (task.tags.length > 0) {
		const tagsEl = div('tb-task-tags');
		for (const tag of task.tags) {
			const tagSpan = span('tb-tag tb-tag--colored', tag);
			if (task.color) tagSpan.style.setProperty('--tb-tag-color', task.color);
			tagsEl.appendChild(tagSpan);
		}
		item.appendChild(tagsEl);
	}

	// Drag events
	item.addEventListener('dragstart', (e) => {
		draggingTaskId = task.id;
		draggingBlockId = null;
		e.dataTransfer?.setData('text/plain', task.id);
		if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
		item.classList.add('tb-dragging');
	});
	item.addEventListener('dragend', () => item.classList.remove('tb-dragging'));

	backlogListEl.appendChild(item);
}

// ── Week navigation ──────────────────────────────────────────────────────────

function buildWeekNav(weekStart) {
	const nav = div('tb-week-nav');
	mainEl.appendChild(nav);

	const prevBtn = el('button', 'tb-nav-btn', '← prev');
	prevBtn.addEventListener('click', () => {
		store.weekOffset -= 1;
		store.save();
		rerenderMain();
		renderBacklogList();
	});
	nav.appendChild(prevBtn);

	const days = getWeekDays(weekStart);
	const label = days[0].toLocaleDateString(undefined, {
		month: 'long', day: 'numeric', year: 'numeric',
	});
	nav.appendChild(span('tb-week-label', `Week of ${label}`));

	const todayBtn = el('button', 'tb-nav-btn', 'Today');
	todayBtn.addEventListener('click', () => {
		store.weekOffset = 0;
		store.save();
		rerenderMain();
		renderBacklogList();
	});
	nav.appendChild(todayBtn);

	const nextBtn = el('button', 'tb-nav-btn', 'Next →');
	nextBtn.addEventListener('click', () => {
		store.weekOffset += 1;
		store.save();
		rerenderMain();
		renderBacklogList();
	});
	nav.appendChild(nextBtn);

	const badge = span('', '⚡ In-browser demo — changes saved to localStorage');
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
		// Checkbox — disabled in preview; vault writes require Obsidian
		const checkbox = document.createElement('input');
		checkbox.type = 'checkbox';
		checkbox.className = 'tb-block-complete';
		checkbox.disabled = true;
		checkbox.setAttribute('aria-label', 'Task completion requires Obsidian (not available in preview)');
		checkbox.title = 'Task completion requires Obsidian (not available in preview)';
		header.appendChild(checkbox);

		const titleLink = el('a', 'tb-block-title tb-block-title--link', block.title);
		titleLink.href = '#';
		titleLink.title = 'Opens task file in Obsidian (not available in preview)';
		titleLink.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); });
		header.appendChild(titleLink);
	} else {
		header.appendChild(div('tb-block-title tb-block-title--static', block.title));
	}
	blockEl.appendChild(header);

	const timeEl = div('tb-block-time', formatBlockTimeLabel(block));
	blockEl.appendChild(timeEl);

	if (block.source !== 'gcal') {
		// Make draggable for repositioning
		blockEl.setAttribute('draggable', 'true');
		blockEl.addEventListener('dragstart', (e) => {
			if (e.target.classList.contains('tb-resize-handle')) {
				e.preventDefault();
				return;
			}
			draggingBlockId = block.id;
			draggingTaskId = null;
			if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
			blockEl.classList.add('tb-dragging');
		});
		blockEl.addEventListener('dragend', () => blockEl.classList.remove('tb-dragging'));

		// Resize handle (bottom edge)
		const handle = div('tb-resize-handle');
		attachResizeHandler(handle, block, blockEl, timeEl);
		blockEl.appendChild(handle);

		// Delete button
		const del = div('tb-block-delete', '×');
		del.title = 'Remove from schedule';
		del.addEventListener('click', (e) => {
			e.stopPropagation();
			store.blocks = store.blocks.filter((b) => b.id !== block.id);
			store.save();
			blockEl.remove();
			renderBacklogList();
		});
		blockEl.appendChild(del);
	}

	slotsEl.appendChild(blockEl);
}

/**
 * Attaches mouse-based resize behaviour to the bottom drag handle.
 * Mirrors the logic in TimeBlockView.ts `attachResizeHandler`.
 */
function attachResizeHandler(handle, block, blockEl, timeEl) {
	handle.addEventListener('mousedown', (e) => {
		e.preventDefault();
		e.stopPropagation();

		const startY = e.clientY;
		const origDuration = block.duration;

		const onMove = (ev) => {
			const deltaY = ev.clientY - startY;
		const deltaMins = snapToGrid((deltaY / HOUR_HEIGHT) * 60);
			block.duration = Math.max(MIN_DURATION, origDuration + deltaMins);
			blockEl.style.height = `${(block.duration / 60) * HOUR_HEIGHT}px`;
			if (timeEl) timeEl.textContent = formatBlockTimeLabel(block);
		};

		const onUp = () => {
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseup', onUp);
			store.save();
		};

		document.addEventListener('mousemove', onMove);
		document.addEventListener('mouseup', onUp);
	});
}

// ── Drop handling ────────────────────────────────────────────────────────────

function handleDrop(dayIndex, startHour, startMinute, weekKey) {
	if (draggingTaskId) {
		const task = store.tasks.find((t) => t.id === draggingTaskId);
		if (task) {
			store.blocks.push({
				id: store.newBlockId(),
				taskId: task.id,
				title: task.title,
				weekStart: weekKey,
				dayIndex,
				startHour,
				startMinute,
				duration: 30,
				color: task.color || '#7B61FF',
				source: 'task',
			});
		}
	} else if (draggingBlockId) {
		const blk = store.blocks.find((b) => b.id === draggingBlockId);
		if (blk) {
			blk.weekStart = weekKey;
			blk.dayIndex = dayIndex;
			blk.startHour = startHour;
			blk.startMinute = startMinute;
		}
	}

	draggingTaskId = null;
	draggingBlockId = null;

	store.save();
	rerenderMain();
	renderBacklogList();
}

// ── Weekly grid ──────────────────────────────────────────────────────────────

function buildGrid(weekStart) {
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

		// Slots container (drop zone)
		const slots = div('tb-slots');
		slots.style.height = `${(totalHours + 1) * HOUR_HEIGHT}px`;

		// Hour grid lines
		for (let h = 0; h <= totalHours; h++) {
			const slot = div('tb-hour-slot');
			slot.style.top = `${h * HOUR_HEIGHT}px`;
			slot.style.height = `${HOUR_HEIGHT}px`;
			slots.appendChild(slot);
		}

		// Current-time indicator (today only)
		if (isToday(day)) renderNowIndicator(slots);

		// Render blocks for this day / week
		for (const block of store.blocks) {
			if (block.weekStart === weekKey && block.dayIndex === dayIndex) {
				renderBlock(block, slots);
			}
		}

		// Drag-and-drop receivers
		slots.addEventListener('dragover', (e) => {
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
			slots.classList.add('tb-drop-active');
		});
		slots.addEventListener('dragleave', () => slots.classList.remove('tb-drop-active'));
		slots.addEventListener('drop', (e) => {
			e.preventDefault();
			slots.classList.remove('tb-drop-active');

			const rect = slots.getBoundingClientRect();
			const rawMinutes = ((e.clientY - rect.top) / HOUR_HEIGHT) * 60;
			const snapped = snapToGrid(rawMinutes);
			const startHour = WORKDAY_START + Math.floor(snapped / 60);
			const startMinute = snapped % 60;

			handleDrop(dayIndex, startHour, startMinute, weekKey);
		});

		col.appendChild(slots);
		gridEl.appendChild(col);
	});
}

// ── Sidebar resizer ──────────────────────────────────────────────────────────

function attachSidebarResizer(resizer) {
	resizer.addEventListener('mousedown', (e) => {
		e.preventDefault();
		const startX = e.clientX;
		const startWidth = sidebarEl.offsetWidth;
		resizer.classList.add('tb-resizing');
		document.body.classList.add('tb-no-user-select');

		const onMove = (ev) => {
			const newWidth = Math.max(150, Math.min(600, startWidth + (ev.clientX - startX)));
			sidebarEl.style.width = `${newWidth}px`;
		};
		const onUp = () => {
			resizer.classList.remove('tb-resizing');
			document.body.classList.remove('tb-no-user-select');
			document.removeEventListener('mousemove', onMove);
			document.removeEventListener('mouseup', onUp);
		};
		document.addEventListener('mousemove', onMove);
		document.addEventListener('mouseup', onUp);
	});
}

// ── Root builder ─────────────────────────────────────────────────────────────

function buildPreview() {
	store.load();

	const app = document.getElementById('app');
	if (!app) return;

	const root = div('tb-root');
	app.appendChild(root);

	// Sidebar (built once; renderBacklogList() updates the list inside it)
	buildSidebar(root);

	// Sidebar resize handle
	const resizer = div('tb-sidebar-resizer');
	attachSidebarResizer(resizer);
	root.appendChild(resizer);

	// Main area (rebuilt on every week navigation)
	mainEl = div('tb-main');
	root.appendChild(mainEl);

	rerenderMain();
}

// Run after DOM is ready
if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', buildPreview);
} else {
	buildPreview();
}
