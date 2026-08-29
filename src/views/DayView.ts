import {
	ItemView,
	MarkdownView,
	Notice,
	TFile,
	WorkspaceLeaf,
	requestUrl,
} from 'obsidian';
import TimeBlockPlugin from '../main';
import { calendarFeedLabel, TimeBlockSettings } from '../settings';
import { GCalEvent, ScheduledBlock, TaskItem } from '../types';
import { parseICS } from '../utils/icsParser';
import { listEvents } from '../gcal/calendarApi';
import {
	mapApiEventsToGCalEvents,
	shouldFetchApiCalendars,
} from '../gcal/eventMapper';
import { applyQuery, parseQuery } from '../utils/queryFilter';
import { queryTasks, scanAllTasks, setTaskCompletion } from '../utils/taskQuery';
import {
	formatDate,
	formatHour,
	isToday,
} from '../utils/weekUtils';

export const DAY_VIEW_TYPE = 'time-block-day-view';

/** Pixels per hour on the time grid (1 px ≈ 1 minute). */
const HOUR_HEIGHT = 60;
/** Minimum schedulable duration, in minutes. */
const MIN_DURATION = 15;
/** Height of the sticky day-header row. */
const DAY_HEADER_HEIGHT = 44;

export class DayView extends ItemView {
	plugin: TimeBlockPlugin;

	private selectedDay: Date;
	private gcalEvents: GCalEvent[] = [];
	private backlogTasks: TaskItem[] = [];
	/** Full task index for scheduled blocks, regardless of backlog filtering. */
	private taskIndex = new Map<string, TaskItem>();

	// Elements rebuilt on each render() call
	private navEl!: HTMLElement;
	private slotsEl!: HTMLElement;

	// Drag state
	private draggingTaskId: string | null = null;
	private draggingBlockId: string | null = null;

	/** Monotonic counter for unique block IDs within this session. */
	private blockIdCounter = 0;

	constructor(leaf: WorkspaceLeaf, plugin: TimeBlockPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.selectedDay = new Date();
		this.selectedDay.setHours(0, 0, 0, 0);
	}

	getViewType(): string {
		return DAY_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Day view';
	}

	getIcon(): string {
		return 'calendar';
	}

	// ── Lifecycle ──────────────────────────────────────────────────────────────

	async onOpen(): Promise<void> {
		this.render();
		await this.refresh();
	}

	async onClose(): Promise<void> {
		// Nothing to clean up; Obsidian removes the DOM automatically.
	}

	// ── Data loading ───────────────────────────────────────────────────────────

	/** Fetches tasks from the vault and GCal events, then re-renders blocks. */
	async refresh(): Promise<void> {
		await Promise.all([this.loadTasks(), this.loadGCalEvents()]);
		this.renderBlocks();
	}

	private async loadTasks(): Promise<void> {
		const { backlogMode, showCompletedTasks, customTaskQuery } =
			this.plugin.settings;

		let all: TaskItem[];

		const raw = await this.rebuildTaskIndex();

		if (backlogMode === 'custom' && customTaskQuery.trim()) {
			const parsed = parseQuery(customTaskQuery);
			all = applyQuery(raw, parsed);
		} else {
			all = await queryTasks(
				this.app,
				{ showCompleted: showCompletedTasks },
				raw
			);
		}

		// Filter out tasks that are already scheduled today so backlog only
		// shows tasks that still need placement.
		const dayKey = formatDate(this.selectedDay);
		const scheduledIds = new Set(
			this.plugin.blocks
				.filter((b) => {
					const blockDay = getBlockDate(b);
					return blockDay === dayKey && b.taskId;
				})
				.map((b) => b.taskId as string)
		);
		this.backlogTasks = all.filter((t) => !scheduledIds.has(t.id));
	}

	private async loadGCalEvents(): Promise<void> {
		const { calendarFeeds, oauthTokens, selectedCalendarIds } =
			this.plugin.settings;
		this.gcalEvents = [];

		const results: GCalEvent[][] = [];

		// ── ICS calendar feeds ────────────────────────────────────────────────
		if (calendarFeeds.length > 0) {
			const feedResults = await Promise.all(
				calendarFeeds.map(async (feed, index) => {
					const url = feed.url.trim();
					if (!url) return [];

					const label = calendarFeedLabel(index);

					if (!url.startsWith('https://')) {
						console.warn(
							`[Time Blocks] ${label} URL rejected: only HTTPS URLs are allowed.`
						);
						new Notice(`Time blocks: ${label} URL must use HTTPS.`);
						return [];
					}

					try {
						const resp = await requestUrl({ url, method: 'GET' });
						const parsed = parseICS(resp.text);
						const feedKey = encodeURIComponent(feed.id);
						return parsed.map((event) => ({
							...event,
							id: `${feedKey}::${encodeURIComponent(event.id)}`,
						}));
					} catch (err) {
						console.error('[Time Blocks] GCal fetch failed:', err);
						new Notice(
							`Time blocks: could not fetch ${label}. Check the calendar URL in plugin settings.`
						);
						return [];
					}
				})
			);
			results.push(...feedResults);
		}

		// ── Google Calendar API (selected calendars overlay) ─────────────────
		if (shouldFetchApiCalendars({ oauthTokens, selectedCalendarIds })) {
			const dayStart = new Date(`${formatDate(this.selectedDay)}T00:00:00`);
			const dayEnd = new Date(dayStart);
			dayEnd.setDate(dayEnd.getDate() + 1);
			const timeMin = dayStart.toISOString();
			const timeMax = dayEnd.toISOString();

			const apiResults = await Promise.all(
				selectedCalendarIds.map(async (calendarId) => {
					try {
						const events = await listEvents(
							this.plugin.buildApiCallbacks(),
							calendarId,
							timeMin,
							timeMax
						);
						return mapApiEventsToGCalEvents(events, calendarId);
					} catch (err) {
						console.error(
							`[Time Blocks] Google Calendar API fetch failed for ${calendarId}:`,
							err
						);
						new Notice(
							`Time blocks: could not fetch calendar ${calendarId}. Check your connection.`
						);
						return [];
					}
				})
			);
			results.push(...apiResults);
		}

		this.gcalEvents = results.flat();
	}

	// ── Top-level rendering ────────────────────────────────────────────────────

	/**
	 * Builds the outer chrome (nav header + time grid).
	 * Called once on open and again whenever the user navigates to a different day.
	 */
	private render(): void {
		const root = this.containerEl.children[1] as HTMLElement;
		root.empty();
		root.addClass('tb-day-root');

		this.buildDayNav(root);
		this.buildGrid(root);
	}

	// ── Day navigation ────────────────────────────────────────────────────────

	private buildDayNav(root: HTMLElement): void {
		this.navEl = root.createDiv('tb-day-nav');

		const prevBtn = this.navEl.createEl('button', {
			cls: 'tb-nav-btn',
			text: '←',
			attr: { 'aria-label': 'Previous day', title: 'Previous day' },
		});
		prevBtn.addEventListener('click', () => this.navigateDay(-1));

		this.navEl.createEl('span', {
			cls: 'tb-day-nav-label',
			text: this.formatDayLabel(this.selectedDay),
		});

		const nextBtn = this.navEl.createEl('button', {
			cls: 'tb-nav-btn',
			text: '→',
			attr: { 'aria-label': 'Next day', title: 'Next day' },
		});
		nextBtn.addEventListener('click', () => this.navigateDay(1));

		const todayBtn = this.navEl.createEl('button', {
			cls: 'tb-nav-btn',
			text: 'Today',
			attr: { 'aria-label': 'Jump to today', title: 'Jump to today' },
		});
		todayBtn.addEventListener('click', () => {
			this.selectedDay = new Date();
			this.selectedDay.setHours(0, 0, 0, 0);
			this.render();
			void this.refresh();
		});

		const refreshBtn = this.navEl.createEl('button', {
			cls: 'tb-nav-btn',
			text: '↻',
			attr: { 'aria-label': 'Refresh', title: 'Refresh' },
		});
		refreshBtn.addEventListener('click', () => void this.refresh());
	}

	private navigateDay(delta: number): void {
		const d = new Date(this.selectedDay);
		d.setDate(d.getDate() + delta);
		this.selectedDay = d;
		this.render();
		void this.refresh();
	}

	private formatDayLabel(day: Date): string {
		return day.toLocaleDateString(undefined, {
			weekday: 'short',
			month: 'short',
			day: 'numeric',
		});
	}

	// ── Time grid ─────────────────────────────────────────────────────────────

	private buildGrid(root: HTMLElement): void {
		const gridWrapper = root.createDiv('tb-day-grid-wrapper');

		const { workdayStart, workdayEnd } = this.plugin.settings;
		const totalHours = workdayEnd - workdayStart;

		// Time-label column
		const timeCol = gridWrapper.createDiv('tb-day-time-col');
		timeCol.createDiv({
			cls: 'tb-time-spacer',
			attr: { style: `height:${DAY_HEADER_HEIGHT}px` },
		});
		for (let h = workdayStart; h <= workdayEnd; h++) {
			const label = timeCol.createDiv('tb-hour-label');
			label.style.height = `${HOUR_HEIGHT}px`;
			label.textContent = formatHour(h);
		}

		// Single day column
		const col = gridWrapper.createDiv('tb-day-col');
		col.dataset.dayIndex = '0';
		if (isToday(this.selectedDay)) col.addClass('tb-today');

		// Sticky header
		const header = col.createDiv('tb-day-header');
		header.style.height = `${DAY_HEADER_HEIGHT}px`;
		header.createEl('span', {
			cls: 'tb-day-name',
			text: this.selectedDay.toLocaleDateString(undefined, { weekday: 'short' }),
		});
		header.createEl('span', {
			cls: 'tb-day-num',
			text: String(this.selectedDay.getDate()),
		});

		// Drop zone
		this.slotsEl = col.createDiv('tb-slots');
		this.slotsEl.style.height = `${(totalHours + 1) * HOUR_HEIGHT}px`;

		// Hour grid lines
		for (let h = 0; h <= totalHours; h++) {
			const slot = this.slotsEl.createDiv('tb-hour-slot');
			slot.style.top = `${h * HOUR_HEIGHT}px`;
			slot.style.height = `${HOUR_HEIGHT}px`;
		}

		// Current-time indicator
		if (isToday(this.selectedDay)) {
			this.renderNowIndicator(this.slotsEl, workdayStart, workdayEnd);
		}

		// Drag-and-drop
		this.slotsEl.addEventListener('dragover', (e: DragEvent) => {
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
			this.slotsEl.addClass('tb-drop-active');
		});
		this.slotsEl.addEventListener('dragleave', () =>
			this.slotsEl.removeClass('tb-drop-active')
		);
		this.slotsEl.addEventListener('drop', (e: DragEvent) => {
			e.preventDefault();
			this.slotsEl.removeClass('tb-drop-active');

			const rect = this.slotsEl.getBoundingClientRect();
			const rawMinutes = ((e.clientY - rect.top) / HOUR_HEIGHT) * 60;
			const snapped = Math.round(rawMinutes / MIN_DURATION) * MIN_DURATION;
			const startHour = workdayStart + Math.floor(snapped / 60);
			const startMinute = snapped % 60;

			void this.handleDrop(startHour, startMinute);
		});
	}

	/** Renders a horizontal line indicating the current time of day. */
	private renderNowIndicator(
		slots: HTMLElement,
		workdayStart: number,
		workdayEnd: number
	): void {
		const now = new Date();
		const nowMinutes = now.getHours() * 60 + now.getMinutes();
		const startMinutes = workdayStart * 60;
		const endMinutes = workdayEnd * 60;

		if (nowMinutes < startMinutes || nowMinutes > endMinutes) return;

		const top = ((nowMinutes - startMinutes) / 60) * HOUR_HEIGHT;
		const indicator = slots.createDiv('tb-now-line');
		indicator.style.top = `${top}px`;
	}

	// ── Drop handling ──────────────────────────────────────────────────────────

	private async handleDrop(startHour: number, startMinute: number): Promise<void> {
		if (this.draggingTaskId) {
			await this.scheduleTask(this.draggingTaskId, startHour, startMinute);
		} else if (this.draggingBlockId) {
			this.moveBlock(this.draggingBlockId, startHour, startMinute);
		}

		this.draggingTaskId = null;
		this.draggingBlockId = null;

		await this.plugin.saveBlocks();
		await this.loadTasks();
		this.renderBlocks();
	}

	private async scheduleTask(
		taskId: string,
		startHour: number,
		startMinute: number
	): Promise<void> {
		let task = this.taskIndex.get(taskId);
		if (!task) {
			await this.rebuildTaskIndex();
			task = this.taskIndex.get(taskId);
		}
		if (!task) return;

		// Compute weekStart (Monday of the selected day's week)
		const weekStart = getWeekStartForDay(this.selectedDay);
		const dayIndex = getDayIndex(this.selectedDay);

		const block: ScheduledBlock = {
			id: `block-${++this.blockIdCounter}-${Date.now()}`,
			taskId,
			title: task.title,
			weekStart: formatDate(weekStart),
			dayIndex,
			startHour,
			startMinute,
			duration: this.plugin.settings.defaultTaskDuration,
			color: resolveTaskColor(task, this.plugin.settings),
			source: 'task',
		};
		this.plugin.blocks.push(block);
	}

	private moveBlock(blockId: string, startHour: number, startMinute: number): void {
		const block = this.plugin.blocks.find((b) => b.id === blockId);
		if (!block) return;
		// Also update dayIndex/weekStart to the currently viewed day
		block.weekStart = formatDate(getWeekStartForDay(this.selectedDay));
		block.dayIndex = getDayIndex(this.selectedDay);
		block.startHour = startHour;
		block.startMinute = startMinute;
	}

	// ── Block rendering ───────────────────────────────────────────────────────

	renderBlocks(): void {
		if (!this.slotsEl) return;

		// Clear existing block elements and now-line
		this.slotsEl.querySelectorAll('.tb-block').forEach((el) => el.remove());
		this.slotsEl.querySelectorAll('.tb-now-line').forEach((el) => el.remove());

		const { workdayStart, workdayEnd } = this.plugin.settings;

		if (isToday(this.selectedDay)) {
			this.renderNowIndicator(this.slotsEl, workdayStart, workdayEnd);
		}

		const dayIndex = getDayIndex(this.selectedDay);
		const weekStartKey = formatDate(getWeekStartForDay(this.selectedDay));

		// Scheduled task / manual blocks for this day
		for (const block of this.plugin.blocks) {
			if (block.weekStart !== weekStartKey) continue;
			if (block.dayIndex !== dayIndex) continue;
			this.renderBlock(block, workdayStart, workdayEnd);
		}

		// GCal events for this day
		for (const event of this.gcalEvents) {
			if (event.isAllDay) continue;
			if (event.start.toDateString() !== this.selectedDay.toDateString()) continue;

			const durationMins = Math.round(
				(event.end.getTime() - event.start.getTime()) / 60_000
			);

			const gcalBlock: ScheduledBlock = {
				id: `gcal-${event.id}-day`,
				gcalEventId: event.id,
				title: event.title,
				weekStart: weekStartKey,
				dayIndex,
				startHour: event.start.getHours(),
				startMinute: event.start.getMinutes(),
				duration: durationMins,
				color: this.plugin.settings.gcalEventColor,
				source: 'gcal',
			};
			this.renderBlock(gcalBlock, workdayStart, workdayEnd);
		}
	}

	private renderBlock(
		block: ScheduledBlock,
		workdayStart: number,
		workdayEnd: number
	): void {
		if (!this.slotsEl) return;
		if (block.startHour < workdayStart || block.startHour >= workdayEnd) return;

		const topPx =
			(block.startHour - workdayStart) * HOUR_HEIGHT +
			(block.startMinute / 60) * HOUR_HEIGHT;
		const heightPx = Math.max((block.duration / 60) * HOUR_HEIGHT, 18);

		const blockEl = this.slotsEl.createDiv('tb-block');
		if (block.source === 'gcal') blockEl.addClass('tb-block--gcal');
		if (block.source === 'task') blockEl.addClass('tb-block--task');

		blockEl.style.top = `${topPx}px`;
		blockEl.style.height = `${heightPx}px`;
		blockEl.style.backgroundColor = block.color;
		blockEl.dataset.blockId = block.id;

		const header = blockEl.createDiv('tb-block-header');
		const task = block.taskId ? this.taskIndex.get(block.taskId) : undefined;
		if (task?.completed) blockEl.addClass('tb-block--completed');

		if (block.source === 'task' && block.taskId) {
			const taskId = block.taskId;
			const complete = header.createEl('input', {
				cls: 'tb-block-complete',
				attr: { type: 'checkbox', 'aria-label': 'Mark task complete' },
			});
			complete.checked = task?.completed ?? false;
			complete.addEventListener('click', (e) => e.stopPropagation());
			complete.addEventListener('change', (e) => {
				e.stopPropagation();
				void this.updateTaskCompletion(taskId, complete.checked);
			});

			const titleButton = header.createEl('button', {
				text: block.title,
				cls: 'tb-block-title tb-block-title--link',
				attr: { type: 'button', 'aria-label': 'Open task in source file' },
			});
			titleButton.addEventListener('click', (e) => {
				e.stopPropagation();
				void this.openTaskSource(taskId);
			});
		} else {
			header.createDiv({
				text: block.title,
				cls: 'tb-block-title tb-block-title--static',
			});
		}

		blockEl.createDiv({
			text: formatBlockTimeLabel(block),
			cls: 'tb-block-time',
		});

		if (block.source !== 'gcal') {
			// Draggable for repositioning
			blockEl.setAttribute('draggable', 'true');
			blockEl.addEventListener('dragstart', (e: DragEvent) => {
				if ((e.target as HTMLElement).classList.contains('tb-resize-handle')) {
					e.preventDefault();
					return;
				}
				this.draggingBlockId = block.id;
				this.draggingTaskId = null;
				if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
				blockEl.addClass('tb-dragging');
			});
			blockEl.addEventListener('dragend', () =>
				blockEl.removeClass('tb-dragging')
			);

			// Resize handle
			const handle = blockEl.createDiv('tb-resize-handle');
			this.attachResizeHandler(handle, block, blockEl);

			// Delete button
			const del = blockEl.createDiv('tb-block-delete');
			del.textContent = '×';
			del.setAttribute('title', 'Remove from schedule');
			del.addEventListener('click', (e: MouseEvent) => {
				e.stopPropagation();
				void this.deleteBlock(block.id);
			});
		}
	}

	/** Attaches mouse-based resize behaviour to the bottom drag handle. */
	private attachResizeHandler(
		handle: HTMLElement,
		block: ScheduledBlock,
		blockEl: HTMLElement
	): void {
		handle.addEventListener('mousedown', (e: MouseEvent) => {
			e.preventDefault();
			e.stopPropagation();

			const startY = e.clientY;
			const origDuration = block.duration;
			const timeEl = blockEl.querySelector<HTMLElement>('.tb-block-time');

			const onMove = (ev: MouseEvent) => {
				const deltaY = ev.clientY - startY;
				const deltaMins =
					Math.round(((deltaY / HOUR_HEIGHT) * 60) / MIN_DURATION) *
					MIN_DURATION;
				block.duration = Math.max(MIN_DURATION, origDuration + deltaMins);
				blockEl.style.height = `${(block.duration / 60) * HOUR_HEIGHT}px`;
				if (timeEl) {
					timeEl.textContent = formatBlockTimeLabel(block);
				}
			};

			const onUp = () => {
				document.removeEventListener('mousemove', onMove);
				document.removeEventListener('mouseup', onUp);
				void this.plugin.saveBlocks();
			};

			document.addEventListener('mousemove', onMove);
			document.addEventListener('mouseup', onUp);
		});
	}

	// ── Helpers ───────────────────────────────────────────────────────────────

	private async deleteBlock(blockId: string): Promise<void> {
		this.plugin.blocks = this.plugin.blocks.filter((b) => b.id !== blockId);
		await this.plugin.saveBlocks();
		await this.loadTasks();
		this.renderBlocks();
	}

	private async resolveTask(taskId: string): Promise<TaskItem | null> {
		const cached = this.taskIndex.get(taskId);
		if (cached) return cached;
		await this.rebuildTaskIndex();
		return this.taskIndex.get(taskId) ?? null;
	}

	private async rebuildTaskIndex(): Promise<TaskItem[]> {
		const raw = await scanAllTasks(this.app);
		this.taskIndex = new Map(raw.map((task) => [task.id, task]));
		return raw;
	}

	private async openTaskSource(taskId: string): Promise<void> {
		const task = await this.resolveTask(taskId);
		if (!task) {
			new Notice('Time blocks: task not found.');
			return;
		}

		const file = this.app.vault.getAbstractFileByPath(task.filePath);
		if (!(file instanceof TFile)) {
			new Notice('Time blocks: task file not found.');
			return;
		}

		const lineIndex = Math.max(task.lineNumber - 1, 0);
		const leaf = this.app.workspace.getLeaf('tab');
		await leaf.openFile(file, { active: true, eState: { line: lineIndex, ch: 0 } });

		const view = leaf.view;
		if (view instanceof MarkdownView) {
			view.editor.setCursor({ line: lineIndex, ch: 0 });
			view.editor.scrollIntoView(
				{ from: { line: lineIndex, ch: 0 }, to: { line: lineIndex, ch: 0 } },
				true
			);
		}
	}

	private async updateTaskCompletion(
		taskId: string,
		completed: boolean
	): Promise<void> {
		const task = await this.resolveTask(taskId);
		if (!task) {
			new Notice('Time blocks: task not found.');
			return;
		}

		const updated = await setTaskCompletion(this.app, task, completed);
		if (!updated) {
			new Notice('Time blocks: unable to update task.');
			return;
		}

		await this.loadTasks();
		this.renderBlocks();
	}
}

// ── Module-level helpers ──────────────────────────────────────────────────────

/** Formats a block's start time and duration as a short label. */
function formatBlockTimeLabel(block: ScheduledBlock): string {
	const startLabel = block.startMinute > 0
		? `${formatHour(block.startHour)}:${String(block.startMinute).padStart(2, '0')}`
		: formatHour(block.startHour);
	return `${startLabel} · ${block.duration} min`;
}

/**
 * Returns the ISO date string (YYYY-MM-DD) for the Monday of the week
 * containing `day`.
 */
function getWeekStartForDay(day: Date): Date {
	const d = new Date(day);
	const dow = d.getDay(); // 0=Sun
	const diff = dow === 0 ? -6 : 1 - dow;
	d.setDate(d.getDate() + diff);
	d.setHours(0, 0, 0, 0);
	return d;
}

/**
 * Returns the 0-based day index (0 = Monday … 6 = Sunday) matching the
 * convention used by ScheduledBlock.dayIndex.
 */
function getDayIndex(day: Date): number {
	const dow = day.getDay(); // 0 = Sun
	return dow === 0 ? 6 : dow - 1;
}

/**
 * Returns the ISO date string of the day a ScheduledBlock falls on, derived
 * from its weekStart and dayIndex.
 */
function getBlockDate(block: ScheduledBlock): string {
	const d = new Date(block.weekStart + 'T00:00:00');
	d.setDate(d.getDate() + block.dayIndex);
	return formatDate(d);
}

/**
 * Returns the color to use for a task block.
 */
function resolveTaskColor(task: TaskItem, settings: TimeBlockSettings): string {
	const map = buildTagColorMap(settings.tagColors);
	for (const tag of task.tags) {
		const color = map.get(tag.toLowerCase());
		if (color) return color;
	}
	return settings.taskBlockColor;
}

/** Builds a lowercase-keyed lookup map from the user's tag-color record. */
function buildTagColorMap(tagColors: Record<string, string>): Map<string, string> {
	const map = new Map<string, string>();
	for (const key of Object.keys(tagColors)) {
		const color = tagColors[key];
		if (color) map.set(key.toLowerCase(), color);
	}
	return map;
}
