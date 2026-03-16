import { App, PluginSettingTab, Setting } from 'obsidian';
import TimeBlockPlugin from './main';

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

	/** When true, completed tasks appear in the backlog. */
	showCompletedTasks: boolean;

	/** Optional tag filter for the backlog (e.g. "#work"). Leave empty to show all tasks. */
	taskTagFilter: string;
}

export const DEFAULT_SETTINGS: TimeBlockSettings = {
	googleCalendarIcsUrl: '',
	defaultTaskDuration: 30,
	workdayStart: 8,
	workdayEnd: 18,
	taskBlockColor: '#7B61FF',
	gcalEventColor: '#4285F4',
	showCompletedTasks: false,
	taskTagFilter: '',
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
	}
}
