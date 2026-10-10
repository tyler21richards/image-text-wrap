// Toolbar icons drawn after Word's Layout Options: a picture box with a little mountain, and text as lines.
// 100 x 100 outlines in currentColor, so they follow the theme like Obsidian's own icons.
// The drawing style (one stroked group per icon) follows image-rows-and-wraps (src/icons.ts), MIT,
// (c) 2026 Black-Manthor; the drawings themselves are new.
import { addIcon, removeIcon, type Plugin } from 'obsidian';
import { ICON } from './ui/layout-choices';

/** A picture: a lightly filled box with one mountain peak, top-left corner at (x, y). */
function picture(x: number, y: number, w: number, h: number): string {
	const base = y + h;
	return (
		`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="5" fill="currentColor" fill-opacity="0.18"/>` +
		`<path d="M${x} ${base - 4}L${x + w * 0.45} ${y + h * 0.42}L${x + w} ${base - 4}"/>`
	);
}

/** Horizontal text lines from x1 to x2 at each y. */
function lines(x1: number, x2: number, ...ys: number[]): string {
	return `<path d="${ys.map((y) => `M${x1} ${y}H${x2}`).join('')}"/>`;
}

const DRAWINGS: Record<string, string> = {
	// A picture sitting on a line of text, with text before and after it.
	[ICON.inline]: lines(8, 92, 14) + picture(32, 30, 36, 34) + lines(8, 22, 64) + lines(78, 92, 64) + lines(8, 92, 86),
	// Picture on the left, text down its right side and then below.
	[ICON.left]: picture(8, 10, 40, 42) + lines(58, 92, 14, 31, 48) + lines(8, 92, 69, 86),
	// Picture on the right, text down its left side and then below.
	[ICON.right]: picture(52, 10, 40, 42) + lines(8, 42, 14, 31, 48) + lines(8, 92, 69, 86),
	// Text above, the picture on its own row, text below.
	[ICON.block]: lines(8, 92, 10) + picture(27, 24, 46, 50) + lines(8, 92, 90),
	// The space between a picture and the text beside it: a picture, a two-way arrow, the text's edge.
	[ICON.spacing]:
		picture(6, 22, 36, 56) + '<path d="M90 16V84M52 50H78M60 41L51 50L60 59M70 41L79 50L70 59"/>',
};

const registered = new WeakSet<Plugin>();

/** Adds the icons once per plugin load and removes them on unload. */
export function registerIcons(plugin: Plugin): void {
	if (registered.has(plugin)) return;
	registered.add(plugin);
	for (const [id, drawing] of Object.entries(DRAWINGS)) {
		addIcon(
			id,
			`<g fill="none" stroke="currentColor" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">${drawing}</g>`,
		);
	}
	plugin.register(() => {
		for (const id of Object.keys(DRAWINGS)) removeIcon(id);
		registered.delete(plugin);
	});
}
