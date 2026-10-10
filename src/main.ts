import { Plugin } from 'obsidian';
import { historyScrollFix } from './edit/write';
import { lineClassField } from './live-preview/line-classes';
import { toolbarExtension, destroyToolbars } from './live-preview/toolbar';
import { dragExtension } from './live-preview/drag';
import { standInExtension } from './live-preview/stand-ins';
import { registerReadingView } from './reading';
import { registerImageMenu } from './menu';
import { registerCommands } from './commands';
import { DEFAULT_SETTINGS, ItwSettingTab, normalizeSettings, type ItwSettings } from './settings';
import { applyCssVariables, clearCssVariables } from './css-vars';

export default class ImageTextWrapPlugin extends Plugin {
	settings: ItwSettings = { ...DEFAULT_SETTINGS };

	async onload() {
		this.settings = normalizeSettings(await this.loadData());
		this.addSettingTab(new ItwSettingTab(this.app, this));

		applyCssVariables(this);
		this.registerEvent(this.app.workspace.on('window-open', () => applyCssVariables(this)));

		this.registerEditorExtension([
			lineClassField,
			historyScrollFix(),
			standInExtension(this),
			toolbarExtension(this),
			dragExtension(this),
		]);
		registerReadingView(this);
		registerImageMenu(this);
		registerCommands(this);
	}

	onunload() {
		destroyToolbars();
		clearCssVariables(this);
	}

	async updateSettings(next: ItwSettings) {
		this.settings = next;
		await this.saveData(next);
		applyCssVariables(this);
	}
}
