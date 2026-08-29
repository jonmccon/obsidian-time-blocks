import { App, Notice, PluginSettingTab, Setting, requestUrl } from 'obsidian';
import type { SettingDefinitionItem, SettingGroupItem } from 'obsidian';
import TimeBlockPlugin from './main';
import {
	buildAuthUrl,
	CALENDAR_SCOPES,
	generateCodeChallenge,
	generateCodeVerifier,
	generateState,
	exchangeCodeForTokens,
} from './gcal/auth';
import { listCalendars } from './gcal/calendarApi';
import type { CalendarListEntry, ConflictStrategy, OAuthTokens } from './gcal/types';
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

	oauthClientSecret: string;

	/**
	 * Google Calendar IDs to display as read-only overlays on the grid.
	 * Populated via the "Overlay calendars" picker in the Two-way sync group.
	 */
	selectedCalendarIds: string[];
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
	oauthClientSecret: '',
	selectedCalendarIds: [],
};

export class TimeBlockSettingTab extends PluginSettingTab {
	plugin: TimeBlockPlugin;
	private calendarConnectionStatus = new Map<string, CalendarConnectionStatus>();
	private pendingCodeVerifier: string | null = null;
	private pendingState: string | null = null;
	private pendingAuthUrl: string | null = null;

	constructor(app: App, plugin: TimeBlockPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	override getSettingDefinitions(): SettingDefinitionItem[] {
		const { settings } = this.plugin;

		// ── Calendar feeds (dynamic) ─────────────────────────────────────────
		const calendarFeedItems: SettingGroupItem[] = [];
		if (settings.calendarFeeds.length === 0) {
			calendarFeedItems.push({
				name: '',
				desc: 'No calendar feeds connected yet. Add one below to overlay events.',
				searchable: false,
			});
		} else {
			for (const [index, feed] of settings.calendarFeeds.entries()) {
				const label = calendarFeedLabel(index);
				calendarFeedItems.push({
					name: label,
					desc:
						'Paste the private ICS feed URL from Google Calendar → Settings → ' +
						'"Secret address in iCal format". The URL starts with https://calendar.google.com/calendar/ical/…',
					render: (setting: Setting) => {
						let draftUrl = feed.url;
						let statusEl: HTMLElement;

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
									this.plugin.settings.calendarFeeds =
										this.plugin.settings.calendarFeeds.filter(
											(entry) => entry.id !== feed.id
										);
									await this.plugin.saveSettings();
									this.update();
								})
						);

						statusEl = setting.controlEl.createDiv({ cls: 'tb-calendar-status' });
						const initialStatus =
							this.calendarConnectionStatus.get(feed.id) ?? 'idle';
						this.setCalendarStatus(feed.id, initialStatus, statusEl);
					},
				});
			}
		}
		calendarFeedItems.push({
			name: 'Add calendar feed',
			desc: 'Connect another calendar feed.',
			render: (setting: Setting) => {
				setting.addButton((btn) =>
					btn
						.setButtonText('Add')
						.setCta()
						.onClick(async () => {
							this.plugin.settings.calendarFeeds.push({
								id: createCalendarFeedId(),
								url: '',
							});
							await this.plugin.saveSettings();
							this.update();
						})
				);
			},
		});

		// ── Tag colors (dynamic) ─────────────────────────────────────────────
		const tagColors = settings.tagColors;
		const tagColorItems: SettingGroupItem[] = Object.keys(tagColors).sort().map((tag) => ({
			name: tag,
			render: (setting: Setting) => {
				setting
					.addColorPicker((picker) =>
						picker
							.setValue(tagColors[tag] ?? settings.taskBlockColor)
							.onChange(async (value) => {
								settings.tagColors[tag] = value;
								await this.plugin.saveSettings();
							})
					)
					.addExtraButton((btn) =>
						btn
							.setIcon('trash')
							.setTooltip('Remove tag color')
							.onClick(async () => {
								delete settings.tagColors[tag];
								await this.plugin.saveSettings();
								this.update();
							})
					);
			},
		}));
		let newTag = '';
		tagColorItems.push({
			name: 'Add tag color',
			desc: 'Enter a tag (e.g. #work) and pick a color.',
			render: (setting: Setting) => {
				setting
					.addText((text) =>
						text
							.setPlaceholder('#tag')
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
								const normalized = trimmed.startsWith('#')
									? trimmed
									: `#${trimmed}`;
								if (settings.tagColors[normalized]) {
									new Notice(`Tag color for ${normalized} already exists.`);
									return;
								}
								settings.tagColors[normalized] = settings.taskBlockColor;
								await this.plugin.saveSettings();
								this.update();
							})
					);
			},
		});

		// ── Auth code input (closure variable shared by sign-in items) ───────
		let authCodeInput = '';

		return [
			// ── Time grid ────────────────────────────────────────────────────
			{
				type: 'group',
				heading: 'Time grid',
				items: [
					{
						name: 'Workday start (hour)',
						desc: 'First hour shown on the weekly grid (0 – 12).',
						control: {
							type: 'slider',
							key: 'workdayStart',
							min: 0,
							max: 12,
							step: 1,
							defaultValue: DEFAULT_SETTINGS.workdayStart,
						},
					},
					{
						name: 'Workday end (hour)',
						desc: 'Last hour shown on the weekly grid (12 – 24).',
						control: {
							type: 'slider',
							key: 'workdayEnd',
							min: 12,
							max: 24,
							step: 1,
							defaultValue: DEFAULT_SETTINGS.workdayEnd,
						},
					},
				],
			},
			// ── Task backlog ─────────────────────────────────────────────────
			{
				type: 'group',
				heading: 'Task backlog',
				items: [
					{
						name: '',
						desc:
							'Backlog mode and the completed-tasks toggle are now available at the top of the Backlog sidebar panel. ' +
							'Tag filters are available as clickable chips just below the search bar.',
						searchable: false,
					},
					{
						name: 'Default task duration (minutes)',
						desc: 'Duration applied when a task is first dropped onto the grid.',
						control: {
							type: 'slider',
							key: 'defaultTaskDuration',
							min: 15,
							max: 240,
							step: 15,
							defaultValue: DEFAULT_SETTINGS.defaultTaskDuration,
						},
					},
				],
			},
			// ── Colors ───────────────────────────────────────────────────────
			{
				type: 'group',
				heading: 'Colors',
				items: [
					{
						name: 'Task block color',
						desc: 'Background color for scheduled task blocks.',
						control: {
							type: 'color',
							key: 'taskBlockColor',
							defaultValue: DEFAULT_SETTINGS.taskBlockColor,
						},
					},
					{
						name: 'Google calendar event color',
						desc: 'Color used for calendar event blocks.',
						control: {
							type: 'color',
							key: 'gcalEventColor',
							defaultValue: DEFAULT_SETTINGS.gcalEventColor,
						},
					},
				],
			},
			// ── Google calendar ──────────────────────────────────────────────
			{
				type: 'group',
				heading: 'Google calendar',
				items: calendarFeedItems,
			},
			// ── Two-way sync ─────────────────────────────────────────────────
			{
				type: 'group',
				heading: 'Two-way sync',
				items: [
					{
						name: 'Enable two-way sync',
						desc:
							'Push scheduled blocks to Google Calendar and pull remote changes. ' +
							'Requires a Google Cloud Console OAuth client ID.',
						control: {
							type: 'toggle',
							key: 'enableTwoWaySync',
							defaultValue: DEFAULT_SETTINGS.enableTwoWaySync,
						},
					},
					{
						name: 'Calendar API client ID',
						desc:
							'Your cloud console OAuth 2.0 client ID. ' +
							'Create one at console.cloud.google.com with the calendar API enabled.',
						control: {
							type: 'text',
							key: 'oauthClientId',
							placeholder: 'Your client ID',
							defaultValue: DEFAULT_SETTINGS.oauthClientId,
						},
						visible: () => settings.enableTwoWaySync,
					},
					{
						name: 'Calendar API client secret',
						desc:
							'Your cloud console OAuth 2.0 client secret. ' +
							'Found alongside your client ID in the Google Cloud Console.',
						control: {
							type: 'text',
							key: 'oauthClientSecret',
							placeholder: 'Your client secret',
							defaultValue: DEFAULT_SETTINGS.oauthClientSecret,
						},
						visible: () => settings.enableTwoWaySync,
					},
					// OAuth sign-in UI (shown when sync enabled, no tokens, client ID present)
					{
						name: 'Calendar sign-in',
						desc:
							'Click "Authorize" to open the sign-in page in your browser. ' +
							'After granting access, paste the full redirect URL (or just the code) below.',
						visible: () =>
							settings.enableTwoWaySync &&
							settings.oauthTokens === null &&
							!!settings.oauthClientId,
						render: (setting: Setting) => {
							setting.addButton((btn) =>
								btn
									.setButtonText('Authorize')
									.setCta()
									.onClick(async () => {
										// Re-entrant: reopen the same URL if a flow is already
										// in progress rather than generating a new verifier.
										if (this.pendingCodeVerifier && this.pendingAuthUrl) {
											window.open(this.pendingAuthUrl);
											return;
										}

										const verifier = generateCodeVerifier();
										const state = generateState();
										this.pendingCodeVerifier = verifier;
										this.pendingState = state;
										const challenge = await generateCodeChallenge(verifier);
										const url = buildAuthUrl({
											clientId: settings.oauthClientId,
											codeChallenge: challenge,
											scopes: CALENDAR_SCOPES,
											state,
										});
										this.pendingAuthUrl = url;
										window.open(url);
									})
							);
						},
					},
					{
						name: 'Authorization code',
						desc:
							'Paste the full redirect URL from your browser address bar ' +
							'(e.g. http://127.0.0.1?code=…&state=…) or just the code. ' +
							'Pasting the full URL allows the plugin to verify the state ' +
							'parameter and protect against cross-site request forgery (CSRF).',
						visible: () =>
							settings.enableTwoWaySync &&
							settings.oauthTokens === null &&
							!!settings.oauthClientId,
						render: (setting: Setting) => {
							setting
								.addText((text) =>
									text
										.setPlaceholder('http://127.0.0.1?code=… or just the code')
										.onChange((value) => {
											authCodeInput = value;
										})
								)
								.addButton((btn) =>
									btn
										.setButtonText('Submit')
										.setCta()
										.onClick(async () => {
											const trimmed = authCodeInput.trim();
											if (!trimmed) {
												new Notice(
													'Time blocks: please enter the authorization code.'
												);
												return;
											}
											if (!this.pendingCodeVerifier) {
												new Notice('Time blocks: click authorize first.');
												return;
											}

											// Accept either a full redirect URL or a bare code.
											let code = trimmed;
											let receivedState: string | null = null;

											try {
												const parsedUrl = new URL(trimmed);
												const codeParam = parsedUrl.searchParams.get('code');
												if (codeParam) {
													code = codeParam;
													receivedState =
														parsedUrl.searchParams.get('state');
												}
											} catch {
												// Not a URL — treat as bare code.
											}

											// Validate state to guard against CSRF.
											if (
												receivedState !== null &&
												(this.pendingState === null ||
													receivedState !== this.pendingState)
											) {
												new Notice(
													'Time blocks: authorization state mismatch — possible security issue. Please authorize again.'
												);
												this.pendingCodeVerifier = null;
												this.pendingState = null;
												this.pendingAuthUrl = null;
												return;
											}

											try {
												const tokens = await exchangeCodeForTokens({
													clientId: settings.oauthClientId,
													clientSecret: settings.oauthClientSecret,
													code,
													codeVerifier: this.pendingCodeVerifier,
												});
												settings.oauthTokens = tokens;
												await this.plugin.saveSettings();
												this.pendingCodeVerifier = null;
												this.pendingState = null;
												this.pendingAuthUrl = null;
												new Notice('Time blocks: signed in to calendar.');
												this.refreshDomState();
											} catch (err) {
												new Notice(
													`Time blocks: authentication failed: ${String(err)}`
												);
											}
										})
								);
						},
					},
					// Authenticated items
					{
						name: 'Calendar account',
						desc: 'Signed in to your calendar account.',
						visible: () =>
							settings.enableTwoWaySync && settings.oauthTokens !== null,
						render: (setting: Setting) => {
							setting.addButton((btn) =>
								btn
									.setButtonText('Sign out')
									.setDestructive()
									.onClick(async () => {
										settings.oauthTokens = null;
										await this.plugin.saveSettings();
										new Notice('Time blocks: signed out of calendar.');
										this.refreshDomState();
									})
							);
						},
					},
					{
						name: 'Overlay calendars',
						desc:
							'Select which Google Calendars to display as read-only overlays on the grid. ' +
							'This is an alternative to pasting ICS feeds.',
						visible: () => settings.oauthTokens !== null,
						render: (setting: Setting) => {
							setting.addButton((btn) =>
								btn
									.setButtonText('Fetch calendars')
									.setCta()
									.onClick(async () => {
										try {
											const cals = await listCalendars(
												this.plugin.buildApiCallbacks()
											);
											renderCalendarChecklist(
												setting.controlEl,
												cals,
												settings.selectedCalendarIds,
												this.plugin
											);
										} catch (err) {
											new Notice(
												`Time blocks: failed to fetch calendars: ${String(err)}`
											);
										}
									})
							);
						},
					},
					{
						name: 'Target calendar',
						desc:
							'Calendar to push scheduled blocks into. ' +
							'Enter a calendar ID or use "primary" for your main calendar.',
						visible: () =>
							settings.enableTwoWaySync && settings.oauthTokens !== null,
						render: (setting: Setting) => {
							setting
								.addText((text) =>
									text
										.setPlaceholder('Calendar ID or primary')
										.setValue(settings.syncCalendarId)
										.onChange(async (value) => {
											settings.syncCalendarId = value.trim() || 'primary';
											await this.plugin.saveSettings();
										})
								)
								.addButton((btn) =>
									btn
										.setButtonText('List calendars')
										.onClick(async () => {
											try {
												const cals = await listCalendars({
													getTokens: () => settings.oauthTokens,
													saveTokens: async (tokens: OAuthTokens) => {
														settings.oauthTokens = tokens;
														await this.plugin.saveSettings();
													},
													clientId: settings.oauthClientId,
													clientSecret: settings.oauthClientSecret,
												});
												const writable = cals.filter(
													(c) =>
														c.accessRole === 'writer' ||
														c.accessRole === 'owner'
												);
												const names = writable
													.map((c) => `${c.summary} (${c.id})`)
													.join('\n');
												new Notice(
													`Time blocks: writable calendars:\n${names || 'None found.'}`
												);
											} catch (err) {
												new Notice(
													`Time blocks: failed to list calendars: ${String(err)}`
												);
											}
										})
								);
						},
					},
					{
						name: 'Conflict resolution',
						desc: 'How to handle events edited in both Obsidian and the calendar.',
						visible: () =>
							settings.enableTwoWaySync && settings.oauthTokens !== null,
						control: {
							type: 'dropdown',
							key: 'conflictStrategy',
							options: {
								ask: 'Ask each time',
								'local-wins': 'Local wins',
								'remote-wins': 'Remote wins',
							},
							defaultValue: DEFAULT_SETTINGS.conflictStrategy,
						},
					},
					{
						name: 'Writable calendars',
						desc:
							'Comma-separated list of calendar IDs the plugin is allowed to write to. ' +
							'Leave empty to only write to the target calendar above.',
						visible: () =>
							settings.enableTwoWaySync && settings.oauthTokens !== null,
						render: (setting: Setting) => {
							setting.addText((text) =>
								text
									.setPlaceholder('Comma-separated calendar ID list')
									.setValue(settings.writableCalendarIds.join(', '))
									.onChange(async (value) => {
										settings.writableCalendarIds = value
											.split(',')
											.map((s) => s.trim())
											.filter(Boolean);
										await this.plugin.saveSettings();
									})
							);
						},
					},
				],
			},
			// ── Tag colors ───────────────────────────────────────────────────
			{
				type: 'group',
				heading: 'Tag colors',
				items: [
					{
						name: '',
						desc:
							'Override the default task color for specific tags. ' +
							'The first matching tag on a task determines its block color.',
						searchable: false,
					},
					...tagColorItems,
				],
			},
		];
	}

	override setControlValue(key: string, value: unknown): Promise<void> {
		(this.plugin.settings as Record<keyof TimeBlockSettings, unknown>)[key as keyof TimeBlockSettings] = value;
		return this.plugin.saveSettings().then(() => {
			this.refreshDomState();
		});
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
	const cryptoObj = window.crypto;
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

/**
 * Renders a checklist of calendars (fetched via the Google Calendar API) into
 * the given container. Each row is a checkbox; toggling it adds/removes the
 * calendar ID from `selectedCalendarIds` and persists the settings.
 */
function renderCalendarChecklist(
	container: HTMLElement,
	calendars: CalendarListEntry[],
	selectedCalendarIds: string[],
	plugin: TimeBlockPlugin
): void {
	container.querySelectorAll('.tb-overlay-cal-list').forEach((el) => el.remove());

	const listEl = container.createDiv({ cls: 'tb-overlay-cal-list' });

	if (calendars.length === 0) {
		listEl.createEl('span', {
			text: 'No calendars found.',
			cls: 'tb-overlay-cal-empty',
		});
		return;
	}

	// ── Header row (count + select/deselect all) ─────────────
	const headerRow = listEl.createDiv({ cls: 'tb-overlay-cal-header' });
	headerRow.createEl('span', {
		cls: 'tb-overlay-cal-count',
		text: `${calendars.length} calendars`,
	});

	const toggleAllBtn = headerRow.createEl('button', {
		cls: 'tb-overlay-cal-toggle-all',
		text: calendars.every((c) => selectedCalendarIds.includes(c.id))
			? 'Deselect all'
			: 'Select all',
	});

	// ── Filter input (only for long lists) ───────────────────
	if (calendars.length > 6) {
		const filterInput = listEl.createEl('input', {
			cls: 'tb-overlay-cal-filter',
			attr: { type: 'text', placeholder: 'Filter calendars\u2026' },
		});
		filterInput.addEventListener('input', () => {
			const query = filterInput.value.toLowerCase();
			listEl
				.querySelectorAll<HTMLElement>('.tb-overlay-cal-row')
				.forEach((rowEl) => {
					const name =
						rowEl
							.querySelector('.tb-overlay-cal-name')
							?.textContent?.toLowerCase() ?? '';
					rowEl.style.display = name.includes(query) ? '' : 'none';
				});
		});
	}

	// ── Calendar rows ────────────────────────────────────────
	const checkboxes: HTMLInputElement[] = [];

	for (const cal of calendars) {
		const row = listEl.createDiv({ cls: 'tb-overlay-cal-row' });

		const cb = row.createEl('input', {
			cls: 'tb-overlay-cal-checkbox',
			attr: { type: 'checkbox' },
		});
		cb.checked = selectedCalendarIds.includes(cal.id);
		checkboxes.push(cb);

		cb.addEventListener('change', () => {
			void (async () => {
				const idx = selectedCalendarIds.indexOf(cal.id);
				if (cb.checked && idx === -1) {
					selectedCalendarIds.push(cal.id);
				}
				if (!cb.checked && idx !== -1) {
					selectedCalendarIds.splice(idx, 1);
				}
				await plugin.saveSettings();
				toggleAllBtn.textContent = calendars.every((c) =>
					selectedCalendarIds.includes(c.id)
				)
					? 'Deselect all'
					: 'Select all';
			})();
		});

		// Color dot (if calendar has a background color)
		if (cal.backgroundColor) {
			row.createEl('span', {
				cls: 'tb-overlay-cal-dot',
				attr: { style: `background-color: ${cal.backgroundColor}` },
			});
		}

		// Label (name + optional role badge)
		const label = row.createDiv({ cls: 'tb-overlay-cal-label' });
		label.createEl('span', { text: cal.summary, cls: 'tb-overlay-cal-name' });

		if (cal.accessRole === 'owner') {
			label.createEl('span', {
				text: 'Owner',
				cls: 'tb-overlay-cal-badge tb-overlay-cal-badge--owner',
			});
		} else if (cal.accessRole === 'writer') {
			label.createEl('span', {
				text: 'Writer',
				cls: 'tb-overlay-cal-badge tb-overlay-cal-badge--writer',
			});
		}

		// Clicking the row toggles the checkbox
		row.addEventListener('click', (e) => {
			if (e.target === cb) return; // already handled by the checkbox itself
			cb.checked = !cb.checked;
			cb.dispatchEvent(new Event('change'));
		});
	}

	// ── Toggle all handler ───────────────────────────────────
	toggleAllBtn.addEventListener('click', () => {
		void (async () => {
			const allSelected = calendars.every((c) =>
				selectedCalendarIds.includes(c.id)
			);
			selectedCalendarIds.length = 0;
			if (!allSelected) {
				calendars.forEach((c) => selectedCalendarIds.push(c.id));
			}
			await plugin.saveSettings();
			checkboxes.forEach((cb, i) => {
				const cal = calendars[i];
				if (cal) cb.checked = selectedCalendarIds.includes(cal.id);
			});
			toggleAllBtn.textContent = allSelected ? 'Select all' : 'Deselect all';
		})();
	});
}

