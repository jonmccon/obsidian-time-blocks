/**
 * Minimal stub for the `obsidian` module so that unit tests can import
 * source files that reference Obsidian types without requiring the
 * Obsidian desktop app to be present.
 *
 * Only the symbols actually imported by the plugin source are stubbed.
 */

/* eslint-disable @typescript-eslint/no-unused-vars */

export class App {}

export class Plugin {
	app = new App();
	loadData(): Promise<unknown> { return Promise.resolve(null); }
	saveData(_data: unknown): Promise<void> { return Promise.resolve(); }
	registerView(_type: string, _factory: unknown): void { /* stub */ }
	addRibbonIcon(_icon: string, _title: string, _cb: () => void): void { /* stub */ }
	addCommand(_cmd: unknown): void { /* stub */ }
	addSettingTab(_tab: unknown): void { /* stub */ }
}

export class PluginSettingTab {
	app: App;
	containerEl = { empty(): void { /* stub */ } };
	constructor(app: App, _plugin: unknown) { this.app = app; }
}

export class Setting {
	constructor(_el: unknown) { /* stub */ }
	setName(_n: string) { return this; }
	setDesc(_d: string) { return this; }
	setHeading() { return this; }
	addText(_cb: unknown) { return this; }
	addSlider(_cb: unknown) { return this; }
	addDropdown(_cb: unknown) { return this; }
	addToggle(_cb: unknown) { return this; }
	addTextArea(_cb: unknown) { return this; }
	addColorPicker(_cb: unknown) { return this; }
	addButton(_cb: unknown) { return this; }
	addExtraButton(_cb: unknown) { return this; }
}

export class Notice {
	constructor(_message: string) { /* stub */ }
}

export class ItemView {
	containerEl = {
		children: [] as unknown[],
		empty(): void { /* stub */ },
	};
	constructor(_leaf: unknown) { /* stub */ }
}

export class WorkspaceLeaf {}

export class TFile {
	path = '';
}

export function requestUrl(_opts: unknown): Promise<{ text: string; json: unknown; status: number; arrayBuffer: ArrayBuffer; headers: Record<string, string> }> {
	return Promise.resolve({ text: '', json: {}, status: 200, arrayBuffer: new ArrayBuffer(0), headers: {} });
}
