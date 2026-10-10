// Settings that rendering needs, passed to styles.css as CSS variables on every window's body.
import type ImageTextWrapPlugin from './main';

export const MAX_WIDTH_VAR = '--itw-max-width';

function windowsOf(plugin: ImageTextWrapPlugin): Window[] {
	const wins = new Set<Window>([window]);
	plugin.app.workspace.iterateAllLeaves((leaf) => {
		const win = leaf.view.containerEl.win;
		if (win) wins.add(win);
	});
	return [...wins];
}

export function cssVariables(plugin: ImageTextWrapPlugin): Record<string, string> {
	return { [MAX_WIDTH_VAR]: `${plugin.settings.maxWrapWidth}%` };
}

export function applyCssVariables(plugin: ImageTextWrapPlugin, el?: HTMLElement): void {
	const vars = cssVariables(plugin);
	if (el) {
		el.setCssProps(vars);
		return;
	}
	for (const win of windowsOf(plugin)) win.document.body.setCssProps(vars);
}

export function clearCssVariables(plugin: ImageTextWrapPlugin): void {
	for (const win of windowsOf(plugin)) win.document.body.style.removeProperty(MAX_WIDTH_VAR);
}
