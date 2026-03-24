import { App, Notice, PluginSettingTab, Setting, requestUrl } from 'obsidian';
import TimeBlockPlugin from './main';
import {
	buildAuthUrl,
	CALENDAR_SCOPES,
	generateCodeChallenge,
	generateCodeVerifier,
	exchangeCodeForTokens,
} from './gcal/auth';
import { listCalendars } from './gcal/calendarApi';
import type { ConflictStrategy, OAuthTokens } from './gcal/types';
import { parseICS } from './utils/icsParser';

/** Controls which tasks appear in the sidebar backlog. */
export type BacklogMode = 'all' | 'custom';

export function calendarFeedLabel(index: number): string {
	return `Calendar feed ${index + 1}`;
}

export interface CalendarFeed {
	id: string;
	/** Private ICS feed URL. */
	url: string;
}

type CalendarConnectionStatus = 'idle' | 'checking' | 'connected' | 'error';

const CALENDAR_STATUS_LABELS: Record<CalendarConnectionStatus, string> = {
	idle: 'Not checked',
	checking: 'Checking…',
	connected: 'Connected',
	error: 'Connection failed',
};

export interface TimeBlockSettings {
	/**
	 * Google Calendar private ICS feed URLs.
	 * Obtained from Google Calendar → Settings → "Secret address in iCal format".
	 */
	calendarFeeds: CalendarFeed[];

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

	// ── Two-way sync (Google Calendar API) ──────────────────────────────────

	/** When true, two-way sync with the Google Calendar API is active. */
	enableTwoWaySync: boolean;

	/** Google Cloud Console OAuth 2.0 client ID (provided by the user). */
	oauthClientId: string;

	/** Stored OAuth tokens (access + refresh). `null` when not authenticated. */
	oauthTokens: OAuthTokens | null;

	/**
	 * The Google Calendar ID to push scheduled blocks into.
	 * Use `'primary'` for the user's main calendar.
	 */
	syncCalendarId: string;

	/** How to resolve conflicts when the same event changed in both places. */
	conflictStrategy: ConflictStrategy;

	/** Calendars the user has explicitly allowed write access to (by calendar ID). */
	writableCalendarIds: string[];
}

export const DEFAULT_SETTINGS: TimeBlockSettings = {
	calendarFeeds: [],
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
	enableTwoWaySync: false,
	oauthClientId: '',
	oauthTokens: null,
	syncCalendarId: 'primary',
	conflictStrategy: 'ask',
	writableCalendarIds: [],
};

export class TimeBlockSettingTab extends PluginSettingTab {
	plugin: TimeBlockPlugin;
	private calendarConnectionStatus = new Map<string, CalendarConnectionStatus>();
	private pendingCodeVerifier: string | null = null;

	constructor(app: App, plugin: TimeBlockPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// ── Google Calendar ──────────────────────────────────────────────────
		new Setting(containerEl).setName('Google calendar').setHeading();

		const calendars = this.plugin.settings.calendarFeeds;

		if (calendars.length === 0) {
			new Setting(containerEl).setDesc(
				'No calendar feeds connected yet. Add one below to overlay events.'
			);
		}

		calendars.forEach((feed, index) => {
			const label = calendarFeedLabel(index);
			let draftUrl = feed.url;
			let statusEl: HTMLElement;

			const setting = new Setting(containerEl)
				.setName(label)
				.setDesc(
					'Paste the private ICS feed URL from Google Calendar → Settings → ' +
					'"Secret address in iCal format". The URL starts with https://calendar.google.com/calendar/ical/…'
				);

			setting.addText((text) =>
				text
					.setPlaceholder('https://calendar.google.com/calendar/ical/…')
					.setValue(feed.url)
					.onChange((value) => {
						draftUrl = value;
						this.setCalendarStatus(feed.id, 'idle', statusEl);
					})
			);

			setting.addButton((btn) =>
				btn
					.setButtonText('Save')
					.setCta()
					.onClick(async () => {
						const trimmed = draftUrl.trim();
						if (!trimmed) {
							this.setCalendarStatus(feed.id, 'error', statusEl);
							new Notice('Time blocks: calendar URL cannot be empty.');
							return;
						}
						if (!trimmed.startsWith('https://')) {
							this.setCalendarStatus(feed.id, 'error', statusEl);
							new Notice('Time blocks: calendar URL must use HTTPS.');
							return;
						}

						feed.url = trimmed;
						await this.plugin.saveSettings();

						this.setCalendarStatus(feed.id, 'checking', statusEl);
						const ok = await this.verifyCalendarFeed(trimmed, label);
						this.setCalendarStatus(feed.id, ok ? 'connected' : 'error', statusEl);
					})
			);

			setting.addExtraButton((btn) =>
				btn
					.setIcon('trash')
					.setTooltip('Remove calendar feed')
					.onClick(async () => {
						this.calendarConnectionStatus.delete(feed.id);
						this.plugin.settings.calendarFeeds = calendars.filter(
							(entry) => entry.id !== feed.id
						);
						await this.plugin.saveSettings();
						this.display();
					})
			);

			statusEl = setting.controlEl.createDiv({ cls: 'tb-calendar-status' });
			const initialStatus = this.calendarConnectionStatus.get(feed.id) ?? 'idle';
			this.setCalendarStatus(feed.id, initialStatus, statusEl);
		});

		new Setting(containerEl)
			.setName('Add calendar feed')
			.setDesc('Connect another calendar feed.')
			.addButton((btn) =>
				btn
					.setButtonText('Add')
					.setCta()
					.onClick(async () => {
						this.plugin.settings.calendarFeeds.push({
							id: createCalendarFeedId(),
							url: '',
						});
						await this.plugin.saveSettings();
						this.display();
					})
			);

		// ── Two-way sync ─────────────────────────────────────────────────────
		new Setting(containerEl).setName('Two-way sync').setHeading();

		new Setting(containerEl)
			.setName('Enable two-way sync')
			.setDesc(
				'Push scheduled blocks to Google Calendar and pull remote changes. ' +
				'Requires a Google Cloud Console OAuth client ID.'
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.enableTwoWaySync)
					.onChange(async (value) => {
						this.plugin.settings.enableTwoWaySync = value;
						await this.plugin.saveSettings();
						this.display();
					})
			);

		if (this.plugin.settings.enableTwoWaySync) {
			new Setting(containerEl)
				.setName('Calendar API client ID')
				.setDesc(
					'Your cloud console OAuth 2.0 client ID. ' +
					'Create one at console.cloud.google.com with the calendar API enabled.'
				)
				.addText((text) =>
					text
						.setPlaceholder('Your client ID')
						.setValue(this.plugin.settings.oauthClientId)
						.onChange(async (value) => {
							this.plugin.settings.oauthClientId = value.trim();
							await this.plugin.saveSettings();
						})
				);

			const isAuthenticated = this.plugin.settings.oauthTokens !== null;

			if (!isAuthenticated && this.plugin.settings.oauthClientId) {
				this.buildOAuthSignInUI(containerEl);
			}

			if (isAuthenticated) {
				new Setting(containerEl)
					.setName('Calendar account')
					.setDesc('Signed in to your calendar account.')
					.addButton((btn) =>
						btn
							.setButtonText('Sign out')
							.setWarning()
							.onClick(async () => {
								this.plugin.settings.oauthTokens = null;
								await this.plugin.saveSettings();
								new Notice('Time blocks: signed out of calendar.');
								this.display();
							})
					);

				new Setting(containerEl)
					.setName('Target calendar')
					.setDesc(
						'Calendar to push scheduled blocks into. ' +
						'Enter a calendar ID or use "primary" for your main calendar.'
					)
					.addText((text) =>
						text
							.setPlaceholder('Calendar ID or primary')
							.setValue(this.plugin.settings.syncCalendarId)
							.onChange(async (value) => {
								this.plugin.settings.syncCalendarId = value.trim() || 'primary';
								await this.plugin.saveSettings();
							})
					)
					.addButton((btn) =>
						btn
							.setButtonText('List calendars')
							.onClick(async () => {
								try {
									const cals = await listCalendars({
										getTokens: () => this.plugin.settings.oauthTokens,
										saveTokens: async (tokens: OAuthTokens) => {
											this.plugin.settings.oauthTokens = tokens;
											await this.plugin.saveSettings();
										},
										clientId: this.plugin.settings.oauthClientId,
									});
									const writable = cals.filter(
										(c) => c.accessRole === 'writer' || c.accessRole === 'owner'
									);
									const names = writable
										.map((c) => `${c.summary} (${c.id})`)
										.join('\n');
									new Notice(
										`Time blocks: writable calendars:\n${names || 'None found.'}`,
									);
								} catch (err) {
									new Notice(`Time blocks: failed to list calendars: ${String(err)}`);
								}
							})
					);

				new Setting(containerEl)
					.setName('Conflict resolution')
					.setDesc(
						'How to handle events edited in both Obsidian and the calendar.'
					)
					.addDropdown((dropdown) =>
						dropdown
							.addOption('ask', 'Ask each time')
							.addOption('local-wins', 'Local wins')
							.addOption('remote-wins', 'Remote wins')
							.setValue(this.plugin.settings.conflictStrategy)
							.onChange(async (value) => {
								this.plugin.settings.conflictStrategy = value as ConflictStrategy;
								await this.plugin.saveSettings();
							})
					);

				new Setting(containerEl)
					.setName('Writable calendars')
					.setDesc(
						'Comma-separated list of calendar IDs the plugin is allowed to write to. ' +
						'Leave empty to only write to the target calendar above.'
					)
					.addText((text) =>
						text
							.setPlaceholder('Comma-separated calendar ID list')
							.setValue(this.plugin.settings.writableCalendarIds.join(', '))
							.onChange(async (value) => {
								this.plugin.settings.writableCalendarIds = value
									.split(',')
									.map((s) => s.trim())
									.filter(Boolean);
								await this.plugin.saveSettings();
							})
					);
			}
		}

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

	private buildOAuthSignInUI(containerEl: HTMLElement): void {
		let authCodeInput = '';

		const signInSetting = new Setting(containerEl)
			.setName('Calendar sign-in')
			.setDesc(
				'Click "Authorize" to open the sign-in page in your browser. ' +
				'After granting access, paste the authorization code below.'
			);

		signInSetting.addButton((btn) =>
			btn
				.setButtonText('Authorize')
				.setCta()
				.onClick(async () => {
					const verifier = generateCodeVerifier();
					this.pendingCodeVerifier = verifier;
					const challenge = await generateCodeChallenge(verifier);
					const url = buildAuthUrl({
						clientId: this.plugin.settings.oauthClientId,
						codeChallenge: challenge,
						scopes: CALENDAR_SCOPES,
					});
					window.open(url);
				})
		);

		new Setting(containerEl)
			.setName('Authorization code')
			.setDesc('Paste the code you received here.')
			.addText((text) =>
				text
					.setPlaceholder('Paste authorization code')
					.onChange((value) => {
						authCodeInput = value;
					})
			)
			.addButton((btn) =>
				btn
					.setButtonText('Submit')
					.setCta()
					.onClick(async () => {
						const code = authCodeInput.trim();
						if (!code) {
							new Notice('Time blocks: please enter the authorization code.');
							return;
						}
						if (!this.pendingCodeVerifier) {
							new Notice('Time blocks: click authorize first.');
							return;
						}

						try {
							const tokens = await exchangeCodeForTokens({
								clientId: this.plugin.settings.oauthClientId,
								code,
								codeVerifier: this.pendingCodeVerifier,
							});
							this.plugin.settings.oauthTokens = tokens;
							await this.plugin.saveSettings();
							this.pendingCodeVerifier = null;
							new Notice('Time blocks: signed in to calendar.');
							this.display();
						} catch (err) {
							new Notice(
								`Time blocks: authentication failed: ${String(err)}`
							);
						}
					})
			);
	}

	private setCalendarStatus(
		feedId: string,
		status: CalendarConnectionStatus,
		statusEl: HTMLElement
	): void {
		this.calendarConnectionStatus.set(feedId, status);
		setCalendarStatusEl(statusEl, status);
	}

	private async verifyCalendarFeed(url: string, label: string): Promise<boolean> {
		try {
			const resp = await requestUrl({ url, method: 'GET' });
			parseICS(resp.text);
			new Notice(`Time blocks: ${label} connected.`);
			return true;
		} catch (err) {
			console.error('[Time Blocks] Calendar feed fetch failed:', err);
			new Notice(
				`Time blocks: could not fetch ${label}. Check the calendar URL in plugin settings.`
			);
			return false;
		}
	}
}

/**
 * Generates a unique calendar feed ID.
 * Prefers `crypto.randomUUID()` when available, then `crypto.getRandomValues()`,
 * and finally falls back to a timestamp + Math.random() for compatibility.
 */
export function createCalendarFeedId(): string {
	// Prefer randomUUID, then getRandomValues, and finally timestamp + Math.random.
	const cryptoObj = globalThis.crypto;
	if (cryptoObj?.randomUUID) {
		return `calendar-${cryptoObj.randomUUID()}`;
	}
	let suffix = '';
	if (cryptoObj?.getRandomValues) {
		const buffer = new Uint32Array(2);
		cryptoObj.getRandomValues(buffer);
		suffix = Array.from(buffer)
			.map((value) => value.toString(16))
			.join('');
	}
	if (!suffix) {
		suffix = Math.random().toString(16).slice(2, 10);
	}
	return `calendar-${Date.now()}-${suffix}`;
}

function setCalendarStatusEl(
	statusEl: HTMLElement,
	status: CalendarConnectionStatus
): void {
	statusEl.textContent = CALENDAR_STATUS_LABELS[status];
	statusEl.classList.remove(
		'tb-calendar-status--idle',
		'tb-calendar-status--checking',
		'tb-calendar-status--connected',
		'tb-calendar-status--error'
	);
	statusEl.classList.add(`tb-calendar-status--${status}`);
}
