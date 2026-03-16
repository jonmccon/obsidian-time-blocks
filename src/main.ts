import { Plugin } from 'obsidian';
import { DEFAULT_SETTINGS, TimeBlockSettings, TimeBlockSettingTab } from './settings';
import { ScheduledBlock } from './types';
import { TIME_BLOCK_VIEW_TYPE, TimeBlockView } from './views/TimeBlockView';

/** Shape of the unified data.json persisted by this plugin. */
interface PersistedData {
	version: number;
	settings: Partial<TimeBlockSettings>;
	blocks: ScheduledBlock[];
}

export default class TimeBlockPlugin extends Plugin {
	settings: TimeBlockSettings = { ...DEFAULT_SETTINGS };
	blocks: ScheduledBlock[] = [];

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

	// ── Persistence ────────────────────────────────────────────────────────────

	/**
	 * Loads settings AND blocks from the shared data.json file.
	 * Must be called once from onload() before any view opens.
	 */
	async loadSettings(): Promise<void> {
		const raw = ((await this.loadData()) ?? {}) as Partial<PersistedData>;
		this.settings = Object.assign({}, DEFAULT_SETTINGS, raw.settings ?? {});
		this.blocks = raw.blocks ?? [];
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
		return { version: 1, settings: this.settings, blocks: this.blocks };
	}
}
