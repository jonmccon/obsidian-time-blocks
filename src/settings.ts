import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import TimeBlockPlugin from './main';

/** Controls which tasks appear in the sidebar backlog. */
export type BacklogMode = 'all' | 'custom';

export interface TimeBlockSettings {
	/**
	 * Google Calendar private ICS URL.
	 * Obtained from Google Calendar → Settings → "Secret address in iCal format".
	 */
	googleCalendarIcsUrl: string;

	/** Default block duration (minutes) when a task is first dropped onto the grid. */
	defaultTaskDuration: number;

	/** Hour (0-23) at which the visible grid starts. */
	workdayStart: number;

	/** Hour (0-23) at which the visible grid ends. */
	workdayEnd: number;

	/** Background color for task blocks (CSS hex string). */
	taskBlockColor: string;

	/** Background color for Google Calendar event blocks (CSS hex string). */
	gcalEventColor: string;

	/**
	 * Per-tag color overrides. Keys are tag strings (e.g. "#work"), values
	 * are CSS hex color strings.  When a task carries a tag listed here its
	 * block uses this color instead of `taskBlockColor`.
	 */
	tagColors: Record<string, string>;

	/** When true, completed tasks appear in the backlog (applies to "All tasks" mode). */
	showCompletedTasks: boolean;

	/** Optional tag filter for the backlog (e.g. "#work"). Applies to "All tasks" mode only. */
	taskTagFilter: string;

	/**
	 * Backlog mode.
	 * - `'all'`    — show every task in the vault (filtered by tag/completed toggles).
	 * - `'custom'` — apply the user-defined query in `customTaskQuery`.
	 */
	backlogMode: BacklogMode;

	/**
	 * Multi-line custom query string using a subset of the Obsidian Tasks
	 * community plugin query syntax.  Only used when `backlogMode === 'custom'`.
	 *
	 * Each line is one filter rule; rules are ANDed together.
	 * Example:
	 *   not done
	 *   due before 2025-12-31
	 *   tag includes #work
	 *   limit to 20 tasks
	 */
	customTaskQuery: string;
}

export const DEFAULT_SETTINGS: TimeBlockSettings = {
	googleCalendarIcsUrl: '',
	defaultTaskDuration: 30,
	workdayStart: 8,
	workdayEnd: 18,
	taskBlockColor: '#7B61FF',
	gcalEventColor: '#4285F4',
	tagColors: {},
	showCompletedTasks: false,
	taskTagFilter: '',
	backlogMode: 'all',
	customTaskQuery: '',
};

export class TimeBlockSettingTab extends PluginSettingTab {
	plugin: TimeBlockPlugin;

	constructor(app: App, plugin: TimeBlockPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// ── Google Calendar ──────────────────────────────────────────────────
		new Setting(containerEl).setName('Google calendar').setHeading();

		new Setting(containerEl)
			.setName('Calendar feed URL')
			.setDesc(
				'Paste the private ICS feed URL from Google Calendar → Settings → ' +
				'"Secret address in iCal format". The URL starts with https://calendar.google.com/calendar/ical/…'
			)
			.addText((text) =>
				text
					.setPlaceholder('https://calendar.google.com/calendar/ical/…')
					.setValue(this.plugin.settings.googleCalendarIcsUrl)
					.onChange(async (value) => {
						this.plugin.settings.googleCalendarIcsUrl = value;
						await this.plugin.saveSettings();
					})
			);

		// ── Grid ─────────────────────────────────────────────────────────────
		new Setting(containerEl).setName('Time grid').setHeading();

		new Setting(containerEl)
			.setName('Workday start (hour)')
			.setDesc('First hour shown on the weekly grid (0 – 12).')
			.addSlider((slider) =>
				slider
					.setLimits(0, 12, 1)
					.setValue(this.plugin.settings.workdayStart)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.workdayStart = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Workday end (hour)')
			.setDesc('Last hour shown on the weekly grid (12 – 24).')
			.addSlider((slider) =>
				slider
					.setLimits(12, 24, 1)
					.setValue(this.plugin.settings.workdayEnd)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.workdayEnd = value;
						await this.plugin.saveSettings();
					})
			);

		// ── Tasks ─────────────────────────────────────────────────────────────
		new Setting(containerEl).setName('Task backlog').setHeading();

		new Setting(containerEl)
			.setName('Default task duration (minutes)')
			.setDesc('Duration applied when a task is first dropped onto the grid.')
			.addSlider((slider) =>
				slider
					.setLimits(15, 240, 15)
					.setValue(this.plugin.settings.defaultTaskDuration)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.defaultTaskDuration = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Backlog mode')
			.setDesc(
				'Choose how the sidebar backlog is populated. ' +
				'"All tasks" shows every task (with optional tag filter). ' +
				'"Custom query" applies a multi-line query using Tasks-plugin-compatible syntax.'
			)
			.addDropdown((dropdown) =>
				dropdown
					.addOption('all', 'All tasks')
					.addOption('custom', 'Custom query')
					.setValue(this.plugin.settings.backlogMode)
					.onChange(async (value) => {
						this.plugin.settings.backlogMode = value as 'all' | 'custom';
						await this.plugin.saveSettings();
						// Redraw to show/hide mode-specific controls
						this.display();
					})
			);

		// ── "All tasks" mode controls ──────────────────────────────────────
		if (this.plugin.settings.backlogMode === 'all') {
			new Setting(containerEl)
				.setName('Tag filter')
				.setDesc(
					'Only show tasks with this tag in the backlog (e.g. #work). ' +
					'Leave blank to include all tasks.'
				)
				.addText((text) =>
					text
						.setPlaceholder('#work')
						.setValue(this.plugin.settings.taskTagFilter)
						.onChange(async (value) => {
							this.plugin.settings.taskTagFilter = value;
							await this.plugin.saveSettings();
						})
				);

			new Setting(containerEl)
				.setName('Show completed tasks')
				.setDesc('Include tasks marked done in the backlog.')
				.addToggle((toggle) =>
					toggle
						.setValue(this.plugin.settings.showCompletedTasks)
						.onChange(async (value) => {
							this.plugin.settings.showCompletedTasks = value;
							await this.plugin.saveSettings();
						})
				);
		}

		// ── "Custom query" mode controls ───────────────────────────────────
		if (this.plugin.settings.backlogMode === 'custom') {
			const queryDescription = document.createDocumentFragment();
			const summary = document.createElement('p');
			summary.textContent =
				'One filter rule per line, using Obsidian Tasks query syntax. ' +
				'Rules are ANDed together. Lines starting with # are comments.';
			queryDescription.appendChild(summary);

			const exampleLabel = document.createElement('p');
			exampleLabel.textContent = 'Examples:';
			queryDescription.appendChild(exampleLabel);

			const examples = document.createElement('ul');
			for (const example of [
				'Not done',
				'Due before 2025-12-31',
				'Tag includes #work',
				'Limit to 20 tasks',
			]) {
				const item = document.createElement('li');
				item.textContent = example;
				examples.appendChild(item);
			}
			queryDescription.appendChild(examples);

			new Setting(containerEl)
				.setName('Custom query')
				.setDesc(queryDescription)
				.addTextArea((area) => {
					area
						.setPlaceholder('Enter query rules, one per line')
						.setValue(this.plugin.settings.customTaskQuery)
						.onChange(async (value) => {
							this.plugin.settings.customTaskQuery = value;
							await this.plugin.saveSettings();
						});
					area.inputEl.rows = 6;
					area.inputEl.addClass('tb-query-textarea');
				});
		}

		// ── Colors ────────────────────────────────────────────────────────────
		new Setting(containerEl).setName('Colors').setHeading();

		new Setting(containerEl)
			.setName('Task block color')
			.setDesc('Background color for scheduled task blocks.')
			.addColorPicker((picker) =>
				picker
					.setValue(this.plugin.settings.taskBlockColor)
					.onChange(async (value) => {
						this.plugin.settings.taskBlockColor = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Google calendar event color')
			.setDesc('Color used for calendar event blocks.')
			.addColorPicker((picker) =>
				picker
					.setValue(this.plugin.settings.gcalEventColor)
					.onChange(async (value) => {
						this.plugin.settings.gcalEventColor = value;
						await this.plugin.saveSettings();
					})
			);

		// ── Tag colors ────────────────────────────────────────────────────────
		new Setting(containerEl)
			.setName('Tag colors')
			.setDesc(
				'Override the default task color for specific tags. ' +
				'The first matching tag on a task determines its block color.'
			)
			.setHeading();

		const tagColors = this.plugin.settings.tagColors;
		for (const tag of Object.keys(tagColors)) {
			new Setting(containerEl)
				.setName(tag)
				.addColorPicker((picker) =>
					picker
						.setValue(tagColors[tag] ?? this.plugin.settings.taskBlockColor)
						.onChange(async (value) => {
							this.plugin.settings.tagColors[tag] = value;
							await this.plugin.saveSettings();
						})
				)
				.addExtraButton((btn) =>
					btn
						.setIcon('trash')
						.setTooltip('Remove tag color')
						.onClick(async () => {
							delete this.plugin.settings.tagColors[tag];
							await this.plugin.saveSettings();
							this.display();
						})
				);
		}

		let newTag = '';
		new Setting(containerEl)
			.setName('Add tag color')
			.setDesc('Enter a tag (e.g. #work) and pick a color.')
			.addText((text) =>
				text
					.setPlaceholder('#tag')
					.setValue(newTag)
					.onChange((value) => {
						newTag = value;
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText('Add')
					.setCta()
					.onClick(async () => {
						const trimmed = newTag.trim();
						if (trimmed.length === 0) return;
						const normalized = trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
						if (this.plugin.settings.tagColors[normalized]) {
							new Notice(`Tag color for ${normalized} already exists.`);
							return;
						}
						this.plugin.settings.tagColors[normalized] =
							this.plugin.settings.taskBlockColor;
						await this.plugin.saveSettings();
						this.display();
					})
			);
	}
}
