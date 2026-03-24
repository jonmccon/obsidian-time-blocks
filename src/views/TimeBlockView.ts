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
import { applyQuery, parseQuery } from '../utils/queryFilter';
import { queryTasks, scanAllTasks, setTaskCompletion } from '../utils/taskQuery';
import {
	addWeeks,
	formatDate,
	formatHour,
	getWeekDays,
	getWeekStart,
	isToday,
} from '../utils/weekUtils';

export const TIME_BLOCK_VIEW_TYPE = 'time-block-view';

/** Pixels per hour on the time grid (1 px ≈ 1 minute). */
const HOUR_HEIGHT = 60;
/** Minimum schedulable duration, in minutes. */
const MIN_DURATION = 15;
/** Height of the sticky day-header row. */
const DAY_HEADER_HEIGHT = 44;

export class TimeBlockView extends ItemView {
	plugin: TimeBlockPlugin;

	private weekStart: Date;
	private gcalEvents: GCalEvent[] = [];
	private backlogTasks: TaskItem[] = [];
	/** Full task index for scheduled blocks, regardless of backlog filtering. */
	private taskIndex = new Map<string, TaskItem>();

	// Elements rebuilt on each render() call
	private sidebarEl!: HTMLElement;
	private mainEl!: HTMLElement;
	private gridEl!: HTMLElement;
	private backlogListEl!: HTMLElement;
	private searchInput!: HTMLInputElement;

	// Drag state
	private draggingTaskId: string | null = null;
	private draggingBlockId: string | null = null;

	/** Monotonic counter for unique block IDs within this session. */
	private blockIdCounter = 0;

	constructor(leaf: WorkspaceLeaf, plugin: TimeBlockPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.weekStart = getWeekStart(new Date());
	}

	getViewType(): string {
		return TIME_BLOCK_VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'Time blocks';
	}

	getIcon(): string {
		return 'calendar-days';
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

	/** Fetches tasks from the vault and GCal events, then re-renders both panels. */
	async refresh(): Promise<void> {
		await Promise.all([this.loadTasks(), this.loadGCalEvents()]);
		this.renderBacklogList();
		this.renderBlocks();
	}

	/** Triggers a two-way sync with Google Calendar for the current week. */
	async triggerSync(): Promise<void> {
		const weekKey = formatDate(this.weekStart);
		await this.plugin.syncWeek(weekKey);
		// Refresh the UI to reflect any changes from the sync
		await this.refresh();
	}

	private async loadTasks(): Promise<void> {
		const { backlogMode, showCompletedTasks, taskTagFilter, customTaskQuery } =
			this.plugin.settings;

		let all: TaskItem[];

		// Keep a full index for scheduled blocks even if the backlog is filtered.
		const raw = await this.rebuildTaskIndex();

		if (backlogMode === 'custom' && customTaskQuery.trim()) {
			// Custom query mode: scan all tasks, then apply the user-defined query
			const parsed = parseQuery(customTaskQuery);
			all = applyQuery(raw, parsed);
		} else {
			// All-tasks mode (default): use tag filter + completed toggle
			all = await queryTasks(
				this.app,
				{
					showCompleted: showCompletedTasks,
					tagFilter: tagFilter(taskTagFilter),
				},
				raw
			);
		}

		// Filter out tasks that are already scheduled this week so the backlog
		// only shows tasks still needing placement.
		const weekKey = formatDate(this.weekStart);
		const scheduledIds = new Set(
			this.plugin.blocks
				.filter((b) => b.weekStart === weekKey && b.taskId)
				.map((b) => b.taskId as string)
		);
		this.backlogTasks = all.filter((t) => !scheduledIds.has(t.id));
	}

	private async loadGCalEvents(): Promise<void> {
		const feeds = this.plugin.settings.calendarFeeds;
		this.gcalEvents = [];

		if (feeds.length === 0) return;

		const results = await Promise.all(
			feeds.map(async (feed, index) => {
				const url = feed.url.trim();
				if (!url) return [];

				const label = calendarFeedLabel(index);

				// Security: only allow HTTPS URLs to prevent accidental fetches to
				// local-network or non-encrypted endpoints.
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
					// Namespace event IDs to avoid collisions across multiple feeds.
					// Use "::" as a literal delimiter between encoded feed and event IDs.
					// To decode, split on "::" and run decodeURIComponent on each part.
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

		this.gcalEvents = results.flat();
	}

	// ── Top-level rendering ────────────────────────────────────────────────────

	/**
	 * Builds the outer chrome (sidebar + main area).  Called once on open and
	 * again whenever the user navigates between weeks.
	 */
	private render(): void {
		const root = this.containerEl.children[1] as HTMLElement;
		root.empty();
		root.addClass('tb-root');

		this.sidebarEl = root.createDiv('tb-sidebar');
		this.mainEl = root.createDiv('tb-main');

		this.buildSidebar();
		this.buildWeekNav();
		this.buildGrid();
	}

	// ── Sidebar ────────────────────────────────────────────────────────────────

	private buildSidebar(): void {
		// Header
		const header = this.sidebarEl.createDiv('tb-sidebar-header');
		const modeLabel = this.plugin.settings.backlogMode === 'custom'
			? 'Backlog (query)'
			: 'Backlog (all)';
		header.createEl('span', { text: modeLabel, cls: 'tb-sidebar-title' });

		const refreshBtn = header.createEl('button', {
			cls: 'tb-icon-btn',
			attr: { 'aria-label': 'Refresh tasks', title: 'Refresh tasks' },
		});
		refreshBtn.textContent = '↻';
		refreshBtn.addEventListener('click', () => { void this.refresh(); });

		// Search/filter
		const searchRow = this.sidebarEl.createDiv('tb-search-row');
		this.searchInput = searchRow.createEl('input', {
			type: 'text',
			cls: 'tb-search-input',
			placeholder: 'Filter tasks…',
		} as Parameters<typeof searchRow.createEl>[1]);
		this.searchInput.addEventListener('input', () => this.renderBacklogList());

		// Scrollable task list
		this.backlogListEl = this.sidebarEl.createDiv('tb-backlog-list');
	}

	private renderBacklogList(): void {
		this.backlogListEl.empty();

		const query = this.searchInput?.value?.toLowerCase() ?? '';
		const visible = this.backlogTasks.filter((t) =>
			t.title.toLowerCase().includes(query)
		);

		if (visible.length === 0) {
			this.backlogListEl.createEl('p', {
				text:
					query
						? 'No matching tasks.'
						: 'No incomplete tasks found in the vault.',
				cls: 'tb-empty-msg',
			});
			return;
		}

		for (const task of visible) {
			this.buildTaskItem(task);
		}
	}

	private buildTaskItem(task: TaskItem): void {
		const el = this.backlogListEl.createDiv('tb-task-item');
		el.setAttribute('draggable', 'true');
		el.dataset.taskId = task.id;
		el.setAttribute('title', `${task.filePath} : line ${task.lineNumber}`);
		if (task.completed) el.addClass('tb-task-item--completed');

		// Tag-color indicator bar (shows the color that will be used for the block)
		const taskColor = resolveTaskColor(task, this.plugin.settings);
		if (taskColor !== this.plugin.settings.taskBlockColor) {
			const indicator = el.createDiv('tb-tag-color-indicator');
			indicator.setCssProps({ '--tb-tag-color': taskColor });
		}

		const header = el.createDiv('tb-task-header');
		const complete = header.createEl('input', {
			cls: 'tb-task-complete',
			attr: { type: 'checkbox', 'aria-label': 'Mark task complete' },
		});
		complete.checked = task.completed;
		complete.addEventListener('click', (e) => e.stopPropagation());
		complete.addEventListener('change', (e) => {
			e.stopPropagation();
			void this.updateTaskCompletion(task.id, complete.checked);
		});

		// Priority indicator
		if (task.priority !== undefined) {
			const icons = ['', '🔺', '⏫', '🔼', '🔽', '⏬'];
			header.createSpan({
				text: icons[task.priority] ?? '',
				cls: 'tb-task-prio',
			});
		}

		const titleButton = header.createEl('button', {
			text: task.title,
			cls: 'tb-task-title',
			attr: { type: 'button', 'aria-label': 'Open task in source file' },
		});
		titleButton.addEventListener('click', (e) => {
			e.stopPropagation();
			void this.openTaskSource(task.id);
		});

		if (task.dueDate) {
			const dateEl = el.createDiv({
				text: `Due ${task.dueDate.toLocaleDateString()}`,
				cls: 'tb-task-due',
			});
			if (task.dueDate < new Date()) dateEl.addClass('tb-overdue');
		}

		if (task.tags.length > 0) {
			const tagsEl = el.createDiv('tb-task-tags');
			const colorMap = buildTagColorMap(this.plugin.settings.tagColors);
			for (const tag of task.tags) {
				const span = tagsEl.createSpan({ text: tag, cls: 'tb-tag' });
				const color = colorMap.get(tag.toLowerCase());
				if (color) {
					span.setCssProps({ '--tb-tag-color': color });
					span.addClass('tb-tag--colored');
				}
			}
		}

		el.addEventListener('dragstart', (e: DragEvent) => {
			this.draggingTaskId = task.id;
			this.draggingBlockId = null;
			e.dataTransfer?.setData('text/plain', task.id);
			if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
			el.addClass('tb-dragging');
		});
		el.addEventListener('dragend', () => el.removeClass('tb-dragging'));
	}

	// ── Week navigation ────────────────────────────────────────────────────────

	private buildWeekNav(): void {
		const nav = this.mainEl.createDiv('tb-week-nav');

		const prevBtn = nav.createEl('button', { cls: 'tb-nav-btn', text: '← prev' });
		prevBtn.addEventListener('click', () => this.navigateWeek(-1));

		const days = getWeekDays(this.weekStart);
		const mondayLabel = days[0].toLocaleDateString(undefined, {
			month: 'long',
			day: 'numeric',
			year: 'numeric',
		});
		nav.createEl('span', {
			cls: 'tb-week-label',
			text: `Week of ${mondayLabel}`,
		});

		const todayBtn = nav.createEl('button', { cls: 'tb-nav-btn', text: 'Today' });
		todayBtn.addEventListener('click', () => {
			this.weekStart = getWeekStart(new Date());
			this.render();
			void this.refresh();
		});

		const nextBtn = nav.createEl('button', { cls: 'tb-nav-btn', text: 'Next →' });
		nextBtn.addEventListener('click', () => this.navigateWeek(1));

		const refreshBtn = nav.createEl('button', {
			cls: 'tb-nav-btn',
			text: '↻ refresh',
		});
		refreshBtn.addEventListener('click', () => void this.refresh());

		// Two-way sync button (only shown when sync is enabled and authenticated)
		if (
			this.plugin.settings.enableTwoWaySync &&
			this.plugin.settings.oauthTokens
		) {
			const syncBtn = nav.createEl('button', {
				cls: 'tb-nav-btn tb-sync-btn',
				text: '⇄ sync',
			});
			syncBtn.addEventListener('click', () => void this.triggerSync());
		}
	}

	private navigateWeek(delta: number): void {
		this.weekStart = addWeeks(this.weekStart, delta);
		this.render();
		void this.refresh();
	}

	// ── Weekly grid ────────────────────────────────────────────────────────────

	private buildGrid(): void {
		this.gridEl = this.mainEl.createDiv('tb-grid');

		const { workdayStart, workdayEnd } = this.plugin.settings;
		const totalHours = workdayEnd - workdayStart;
		const days = getWeekDays(this.weekStart);

		// Time-label column
		const timeCol = this.gridEl.createDiv('tb-time-col');
		// Spacer to align with sticky day headers
		timeCol.createDiv({
			cls: 'tb-time-spacer',
			attr: { style: `height:${DAY_HEADER_HEIGHT}px` },
		});
		for (let h = workdayStart; h <= workdayEnd; h++) {
			const label = timeCol.createDiv('tb-hour-label');
			label.style.height = `${HOUR_HEIGHT}px`;
			label.textContent = formatHour(h);
		}

		// Day columns
		days.forEach((day, d) =>
			this.buildDayColumn(day, d, totalHours, workdayStart, workdayEnd)
		);
	}

	private buildDayColumn(
		day: Date,
		dayIndex: number,
		totalHours: number,
		workdayStart: number,
		workdayEnd: number
	): void {
		const col = this.gridEl.createDiv('tb-day-col');
		col.dataset.dayIndex = String(dayIndex);
		if (isToday(day)) col.addClass('tb-today');

		// Sticky header
		const header = col.createDiv('tb-day-header');
		header.style.height = `${DAY_HEADER_HEIGHT}px`;
		header.createEl('span', {
			cls: 'tb-day-name',
			text: day.toLocaleDateString(undefined, { weekday: 'short' }),
		});
		header.createEl('span', {
			cls: 'tb-day-num',
			text: String(day.getDate()),
		});

		// Drop zone (time slots container)
		const slots = col.createDiv('tb-slots');
		slots.style.height = `${(totalHours + 1) * HOUR_HEIGHT}px`;

		// Hour grid lines
		for (let h = 0; h <= totalHours; h++) {
			const slot = slots.createDiv('tb-hour-slot');
			slot.style.top = `${h * HOUR_HEIGHT}px`;
			slot.style.height = `${HOUR_HEIGHT}px`;
		}

		// Current-time indicator (only for today)
		if (isToday(day)) {
			this.renderNowIndicator(slots, workdayStart, workdayEnd);
		}

		// Drag-and-drop receivers
		slots.addEventListener('dragover', (e: DragEvent) => {
			e.preventDefault();
			if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
			slots.addClass('tb-drop-active');
		});
		slots.addEventListener('dragleave', () => slots.removeClass('tb-drop-active'));
		slots.addEventListener('drop', (e: DragEvent) => {
			e.preventDefault();
			slots.removeClass('tb-drop-active');

			const rect = slots.getBoundingClientRect();
			const rawMinutes = ((e.clientY - rect.top) / HOUR_HEIGHT) * 60;
			const snapped =
				Math.round(rawMinutes / MIN_DURATION) * MIN_DURATION;
			const startHour = workdayStart + Math.floor(snapped / 60);
			const startMinute = snapped % 60;

			void this.handleDrop(dayIndex, startHour, startMinute);
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

	private async handleDrop(
		dayIndex: number,
		startHour: number,
		startMinute: number
	): Promise<void> {
		if (this.draggingTaskId) {
			await this.scheduleTask(this.draggingTaskId, dayIndex, startHour, startMinute);
		} else if (this.draggingBlockId) {
			this.moveBlock(this.draggingBlockId, dayIndex, startHour, startMinute);
		}

		this.draggingTaskId = null;
		this.draggingBlockId = null;

		await this.plugin.saveBlocks();
		await this.loadTasks();
		this.renderBacklogList();
		this.renderBlocks();
	}

	private async scheduleTask(
		taskId: string,
		dayIndex: number,
		startHour: number,
		startMinute: number
	): Promise<void> {
		// Find task in already-loaded backlog, or re-query
		let task = this.taskIndex.get(taskId);
		if (!task) {
			await this.rebuildTaskIndex();
			task = this.taskIndex.get(taskId);
		}
		if (!task) return;

		const block: ScheduledBlock = {
			id: `block-${++this.blockIdCounter}-${Date.now()}`,
			taskId,
			title: task.title,
			weekStart: formatDate(this.weekStart),
			dayIndex,
			startHour,
			startMinute,
			duration: this.plugin.settings.defaultTaskDuration,
			color: resolveTaskColor(task, this.plugin.settings),
			source: 'task',
		};
		this.plugin.blocks.push(block);
	}

	private moveBlock(
		blockId: string,
		dayIndex: number,
		startHour: number,
		startMinute: number
	): void {
		const block = this.plugin.blocks.find((b) => b.id === blockId);
		if (!block) return;
		block.dayIndex = dayIndex;
		block.startHour = startHour;
		block.startMinute = startMinute;
	}

	// ── Block rendering ────────────────────────────────────────────────────────

	/** Removes stale block elements and re-renders all blocks for the current week. */
	renderBlocks(): void {
		// Clear existing block elements
		this.gridEl?.querySelectorAll('.tb-block').forEach((el) => el.remove());
		this.gridEl?.querySelectorAll('.tb-now-line').forEach((el) => el.remove());

		const { workdayStart, workdayEnd } = this.plugin.settings;
		const weekKey = formatDate(this.weekStart);
		const weekDays = getWeekDays(this.weekStart);

		// Re-draw now indicator (it was inside slots, which we just cleared)
		weekDays.forEach((day, d) => {
			if (isToday(day)) {
				const slotsEl = this.getDaySlots(d);
				if (slotsEl) this.renderNowIndicator(slotsEl, workdayStart, workdayEnd);
			}
		});

		// Scheduled task / manual blocks
		for (const block of this.plugin.blocks) {
			if (block.weekStart !== weekKey) continue;
			this.renderBlock(block, workdayStart, workdayEnd);
		}

		// GCal events for this week
		for (const event of this.gcalEvents) {
			if (event.isAllDay) continue;

			weekDays.forEach((day, d) => {
				if (event.start.toDateString() !== day.toDateString()) return;

				const durationMins = Math.round(
					(event.end.getTime() - event.start.getTime()) / 60_000
				);

				const gcalBlock: ScheduledBlock = {
					id: `gcal-${event.id}-${d}`,
					gcalEventId: event.id,
					title: event.title,
					weekStart: weekKey,
					dayIndex: d,
					startHour: event.start.getHours(),
					startMinute: event.start.getMinutes(),
					duration: durationMins,
					color: this.plugin.settings.gcalEventColor,
					source: 'gcal',
				};
				this.renderBlock(gcalBlock, workdayStart, workdayEnd);
			});
		}
	}

	private renderBlock(
		block: ScheduledBlock,
		workdayStart: number,
		workdayEnd: number
	): void {
		const slotsEl = this.getDaySlots(block.dayIndex);
		if (!slotsEl) return;

		// Skip blocks that start outside the visible workday
		if (block.startHour < workdayStart || block.startHour >= workdayEnd) return;

		const topPx =
			(block.startHour - workdayStart) * HOUR_HEIGHT +
			(block.startMinute / 60) * HOUR_HEIGHT;
		const heightPx = Math.max((block.duration / 60) * HOUR_HEIGHT, 18);

		const blockEl = slotsEl.createDiv('tb-block');
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
			// Make block draggable for repositioning
			blockEl.setAttribute('draggable', 'true');
			blockEl.addEventListener('dragstart', (e: DragEvent) => {
				// Don't trigger if user clicked the resize handle
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

			// Resize handle (bottom edge drag)
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
					Math.round((deltaY / HOUR_HEIGHT) * 60 / MIN_DURATION) *
					MIN_DURATION;
				block.duration = Math.max(
					MIN_DURATION,
					origDuration + deltaMins
				);
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

	// ── Helpers ────────────────────────────────────────────────────────────────

	/** Removes a block from the schedule and refreshes the UI. */
	private async deleteBlock(blockId: string): Promise<void> {
		this.plugin.blocks = this.plugin.blocks.filter((b) => b.id !== blockId);
		await this.plugin.saveBlocks();
		await this.loadTasks();
		this.renderBacklogList();
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
			const centerOnLine = true;
			view.editor.scrollIntoView(
				{ from: { line: lineIndex, ch: 0 }, to: { line: lineIndex, ch: 0 } },
				centerOnLine
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
		this.renderBacklogList();
		this.renderBlocks();
	}

	private getDaySlots(dayIndex: number): HTMLElement | null {
		const col = this.gridEl?.querySelector(
			`.tb-day-col[data-day-index="${dayIndex}"]`
		);
		return col ? col.querySelector<HTMLElement>('.tb-slots') : null;
	}
}


/** Formats a block's start time and duration as a short label, e.g. "9 AM · 30 min". */
function formatBlockTimeLabel(block: ScheduledBlock): string {
	const startLabel = block.startMinute > 0
		? `${formatHour(block.startHour)}:${String(block.startMinute).padStart(2, '0')}`
		: formatHour(block.startHour);
	return `${startLabel} · ${block.duration} min`;
}

/** Returns `undefined` when the filter string is empty/whitespace. */
function tagFilter(raw: string): string | undefined {
	const trimmed = raw.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Returns the color to use for a task block.
 * Checks the task's tags against `settings.tagColors`; the first match wins.
 * Falls back to `settings.taskBlockColor` when no tag color is configured.
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
