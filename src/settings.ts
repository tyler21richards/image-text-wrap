import { PluginSettingTab, type App, type SettingDefinitionItem } from 'obsidian';
import { GAPS, type Gap } from './grammar';
import type ImageTextWrapPlugin from './main';

export interface ItwSettings {
	/** Spacing an image gets when wrapping is first turned on for it. */
	defaultGap: Gap;
	/** Widest a wrapped image is shown, as a percentage of the note column. */
	maxWrapWidth: number;
	/** Show the layout toolbar when an image is selected in Live Preview. */
	showToolbar: boolean;
	/** Move images by dragging them in Live Preview. Off hands dragging back to Obsidian. */
	dragToMove: boolean;
}

export const DEFAULT_SETTINGS: ItwSettings = {
	defaultGap: 16,
	maxWrapWidth: 50,
	showToolbar: true,
	dragToMove: true,
};

export const GAP_LABELS: Record<Gap, string> = {
	0: 'None',
	8: 'Small (8 px)',
	16: 'Medium (16 px)',
	24: 'Large (24 px)',
};

/** Reads saved data defensively: unknown or broken values fall back to the defaults. */
export function normalizeSettings(raw: unknown): ItwSettings {
	const data = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof ItwSettings, unknown>>;
	const gap = Number(data.defaultGap);
	const width = Number(data.maxWrapWidth);
	return {
		defaultGap: (GAPS as readonly number[]).includes(gap) ? (gap as Gap) : DEFAULT_SETTINGS.defaultGap,
		maxWrapWidth: Number.isFinite(width) ? Math.min(80, Math.max(20, Math.round(width))) : DEFAULT_SETTINGS.maxWrapWidth,
		showToolbar: typeof data.showToolbar === 'boolean' ? data.showToolbar : DEFAULT_SETTINGS.showToolbar,
		dragToMove: typeof data.dragToMove === 'boolean' ? data.dragToMove : DEFAULT_SETTINGS.dragToMove,
	};
}

export class ItwSettingTab extends PluginSettingTab {
	constructor(
		app: App,
		private readonly plugin: ImageTextWrapPlugin,
	) {
		super(app, plugin);
	}

	getSettingDefinitions(): SettingDefinitionItem[] {
		return [
			{
				name: 'Show the picture toolbar',
				desc: 'When you click an image in Live Preview, show buttons for text wrapping and spacing above it.',
				control: { type: 'toggle', key: 'showToolbar' },
			},
			{
				name: 'Move images by dragging',
				desc: 'Drag an image to another place in the note. Turn this off to use Obsidian\'s own image dragging instead.',
				control: { type: 'toggle', key: 'dragToMove' },
			},
			{
				name: 'Default spacing',
				desc: 'The space between a wrapped image and the text around it, used when you first turn on wrapping for an image.',
				control: {
					type: 'dropdown',
					key: 'defaultGap',
					options: Object.fromEntries(GAPS.map((g) => [String(g), GAP_LABELS[g]])),
				},
			},
			{
				name: 'Widest wrapped image',
				desc: 'A wrapped image is shown no wider than this share of the note column. The size stored in the note does not change.',
				control: {
					type: 'slider',
					key: 'maxWrapWidth',
					min: 20,
					max: 80,
					step: 5,
					displayFormat: (v: number) => `${v}%`,
				},
			},
		];
	}

	getControlValue(key: string): unknown {
		const value = this.plugin.settings[key as keyof ItwSettings];
		return key === 'defaultGap' ? String(value) : value;
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const next = normalizeSettings({
			...this.plugin.settings,
			[key]: key === 'defaultGap' ? Number(value) : value,
		});
		await this.plugin.updateSettings(next);
	}
}
