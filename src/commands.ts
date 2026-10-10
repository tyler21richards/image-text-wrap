// Commands for the layout choices (extras; the toolbar and the right-click menu are the main routes).
// Each acts on the selected image, or else the image link on the cursor's line, and only shows in the
// command palette when it would change something.
import type { MarkdownFileInfo } from 'obsidian';
import { GAPS, type Gap, type Layout, type Wrap } from './grammar';
import { viewOfEditor } from './live-preview/toolbar';
import { applyLayout, targetForCommand } from './live-preview/toolbar-target';
import type ImageTextWrapPlugin from './main';
import { GAP_LABELS } from './settings';
import { ICON, WRAP_CHOICES, layoutForGap, layoutForWrapCommand } from './ui/layout-choices';

const WRAP_COMMANDS: { id: string; name: string; wrap: Wrap }[] = [
	{ id: 'wrap-left', name: 'Wrap selected image: left', wrap: 'left' },
	{ id: 'wrap-right', name: 'Wrap selected image: right', wrap: 'right' },
	{ id: 'wrap-top-and-bottom', name: 'Wrap selected image: top and bottom', wrap: 'block' },
	{ id: 'wrap-none', name: 'Wrap selected image: in line with text', wrap: 'none' },
];

const GAP_IDS: Record<Gap, string> = { 0: 'none', 8: 'small', 16: 'medium', 24: 'large' };

/** Runs (or, when checking, tests) a layout change on the command's image. */
function run(checking: boolean, info: MarkdownFileInfo, next: (current: Layout) => Layout | null): boolean {
	const view = viewOfEditor(info);
	const target = view ? targetForCommand(view) : null;
	const layout = target ? next(target.link.layout) : null;
	if (!target || !layout) return false;
	if (!checking) applyLayout(target, layout);
	return true;
}

export function registerCommands(plugin: ImageTextWrapPlugin): void {
	for (const command of WRAP_COMMANDS) {
		plugin.addCommand({
			id: command.id,
			name: command.name,
			icon: WRAP_CHOICES.find((c) => c.wrap === command.wrap)?.icon,
			editorCheckCallback: (checking, _editor, info) =>
				run(checking, info, (current) => layoutForWrapCommand(current, command.wrap, plugin.settings.defaultGap)),
		});
	}
	for (const gap of GAPS) {
		plugin.addCommand({
			id: `spacing-${GAP_IDS[gap]}`,
			name: `Set spacing of selected image: ${GAP_LABELS[gap].toLowerCase()}`,
			icon: ICON.spacing,
			editorCheckCallback: (checking, _editor, info) => run(checking, info, (current) => layoutForGap(current, gap)),
		});
	}
}
