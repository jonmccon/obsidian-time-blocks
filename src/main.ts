import { Notice, Plugin } from 'obsidian';
import {
	createCalendarFeedId,
	DEFAULT_SETTINGS,
	TimeBlockSettings,
	TimeBlockSettingTab,
} from './settings';
import type { EventMapping } from './gcal/types';
import type { OAuthTokens } from './gcal/types';
import type { CalendarApiCallbacks } from './gcal/calendarApi';
import { runSync } from './gcal/syncEngine';
import { ScheduledBlock } from './types';
import { TIME_BLOCK_VIEW_TYPE, TimeBlockView } from './views/TimeBlockView';

/** Shape of the unified data.json persisted by this plugin. */
interface PersistedData {
	version: number;
	settings: Partial<TimeBlockSettings>;
	blocks: ScheduledBlock[];
	/** Mappings between local blocks and Google Calendar events. */
	eventMappings?: EventMapping[];
}

export default class TimeBlockPlugin extends Plugin {
	settings: TimeBlockSettings = { ...DEFAULT_SETTINGS };
	blocks: ScheduledBlock[] = [];
	/** Persisted mappings linking blocks ↔ Google Calendar events. */
	eventMappings: EventMapping[] = [];
	/** Guard to prevent concurrent sync operations. */
	private syncing = false;

	async onload(): Promise<void> {
		await this.loadSettings();

		// Register the weekly time-block view
		this.registerView(
			TIME_BLOCK_VIEW_TYPE,
			(leaf) => new TimeBlockView(leaf, this)
		);

		// Ribbon button
		this.addRibbonIcon('calendar-days', 'Open time blocks', () => {
			void this.activateView();
		});

		// Commands
		this.addCommand({
			id: 'open',
			name: 'Open weekly time-block view',
			callback: () => void this.activateView(),
		});

		this.addCommand({
			id: 'refresh',
			name: 'Refresh time-block view',
			callback: () => {
				const views = this.app.workspace
					.getLeavesOfType(TIME_BLOCK_VIEW_TYPE)
					.map((l) => l.view)
					.filter((v): v is TimeBlockView => v instanceof TimeBlockView);
				views.forEach((v) => { void v.refresh(); });
			},
		});

		this.addCommand({
			id: 'sync-calendar',
			name: 'Sync calendar events',
			callback: () => {
				const views = this.app.workspace
					.getLeavesOfType(TIME_BLOCK_VIEW_TYPE)
					.map((l) => l.view)
					.filter((v): v is TimeBlockView => v instanceof TimeBlockView);
				views.forEach((v) => { void v.triggerSync(); });
			},
		});

		// Settings tab
		this.addSettingTab(new TimeBlockSettingTab(this.app, this));
	}

	onunload(): void {
		// No cleanup needed; Obsidian removes views when the plugin is disabled.
	}

	/** Opens (or focuses) the time-block view in a new tab. */
	async activateView(): Promise<void> {
		const { workspace } = this.app;

		let leaf = workspace.getLeavesOfType(TIME_BLOCK_VIEW_TYPE)[0];
		if (!leaf) {
			leaf = workspace.getLeaf('tab');
			await leaf.setViewState({ type: TIME_BLOCK_VIEW_TYPE, active: true });
		}
		void workspace.revealLeaf(leaf);
	}

	// ── Two-way sync ──────────────────────────────────────────────────────────

	/**
	 * Builds the CalendarApiCallbacks object needed by the API client and sync
	 * engine, wiring token storage through the plugin's settings.
	 */
	buildApiCallbacks(): CalendarApiCallbacks {
		return {
			getTokens: () => this.settings.oauthTokens,
			saveTokens: async (tokens: OAuthTokens) => {
				this.settings.oauthTokens = tokens;
				await this.saveSettings();
			},
			clientId: this.settings.oauthClientId,
		};
	}

	/**
	 * Runs a two-way sync for the given week.
	 * Called from the view when the user triggers a sync.
	 */
	async syncWeek(weekStart: string): Promise<void> {
		if (!this.settings.enableTwoWaySync) return;
		if (!this.settings.oauthTokens) {
			new Notice('Time blocks: sign in to your calendar account first.');
			return;
		}
		if (this.syncing) {
			new Notice('Time blocks: sync already in progress.');
			return;
		}

		this.syncing = true;
		try {
			const result = await runSync(
				{
					api: this.buildApiCallbacks(),
					targetCalendarId: this.settings.syncCalendarId,
					conflictStrategy: this.settings.conflictStrategy,
					getBlocks: () => this.blocks,
					setBlocks: (blocks) => { this.blocks = blocks; },
					getMappings: () => this.eventMappings,
					saveMappings: async (mappings) => {
						this.eventMappings = mappings;
						await this.saveData(this.buildPayload());
					},
				},
				weekStart
			);

			// Summarize
			const parts: string[] = [];
			if (result.created > 0) parts.push(`${result.created} created`);
			if (result.updated > 0) parts.push(`${result.updated} updated`);
			if (result.deleted > 0) parts.push(`${result.deleted} deleted`);
			if (result.conflicts.length > 0)
				parts.push(`${result.conflicts.length} conflicts`);
			if (result.errors.length > 0)
				parts.push(`${result.errors.length} errors`);

			const summary = parts.length > 0
				? `Sync complete: ${parts.join(', ')}.`
				: 'Sync complete: no changes.';
			new Notice(`Time blocks: ${summary}`);

			if (result.errors.length > 0) {
				console.error('[Time Blocks] Sync errors:', result.errors);
			}
		} finally {
			this.syncing = false;
		}
	}

	// ── Persistence ────────────────────────────────────────────────────────────

	/**
	 * Loads settings AND blocks from the shared data.json file.
	 * Must be called once from onload() before any view opens.
	 */
	async loadSettings(): Promise<void> {
		const raw = (await this.loadData() ?? {}) as Partial<PersistedData>;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, raw.settings ?? {});
		this.blocks = raw.blocks ?? [];
		this.eventMappings = raw.eventMappings ?? [];

		if (!Array.isArray(this.settings.calendarFeeds)) {
			this.settings.calendarFeeds = [];
		}

		interface LegacySettings extends Partial<TimeBlockSettings> {
			googleCalendarIcsUrl?: string;
		}
		const legacyUrl = (raw.settings as LegacySettings | undefined)?.googleCalendarIcsUrl;
		if (legacyUrl && this.settings.calendarFeeds.length === 0) {
			this.settings.calendarFeeds = [
				{ id: createCalendarFeedId(), url: legacyUrl },
			];
			await this.saveSettings();
		}
	}

	/** Saves only the settings portion (blocks are preserved). */
	async saveSettings(): Promise<void> {
		await this.saveData(this.buildPayload());
	}

	/** Saves only the blocks portion (settings are preserved). */
	async saveBlocks(): Promise<void> {
		await this.saveData(this.buildPayload());
	}

	private buildPayload(): PersistedData {
		return {
			version: 1,
			settings: this.settings,
			blocks: this.blocks,
			eventMappings: this.eventMappings,
		};
	}
}
