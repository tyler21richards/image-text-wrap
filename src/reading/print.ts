// PDF export. Obsidian renders the whole note into a print window and post-processes its root once,
// with no section information, so the per-section class of Reading view never reaches it: the root
// gets the class instead, plus the settings as CSS variables (the print window has its own <body>).
//
// Page breaks: Chromium moves a float that does not fit on the page to the next page alone, and the
// text it is wrapped in stays behind at full width (measured in the export, brief M4). The paragraph
// that holds a wrapped image is kept whole instead, and a heading right before it goes with it.
// The idea and the measurement come from Adjustable Media (src/view/printView.ts, keepFloatsWithAnchors),
// MIT, (c) 2026 Yi-luo-hua.
import { applyCssVariables } from '../css-vars';
import { READING_IMAGES } from '../dom';
import type ImageTextWrapPlugin from '../main';
import { keepWithNext, wrapFromAlt, type PrintBlockKind } from './wraps';

export const WRAP_NOTE_CLASS = 'itw-wrap-note';
export const PRINT_FLOAT_CLASS = 'itw-print-float';
export const PRINT_KEEP_CLASS = 'itw-print-keep-with-next';

const HEADING = /^H[1-6]$/;

export function preparePrint(plugin: ImageTextWrapPlugin, root: HTMLElement, hasFloat: boolean): void {
	root.toggleClass(WRAP_NOTE_CLASS, hasFloat);
	if (!hasFloat) return;
	applyCssVariables(plugin, root);
	markPageBreaks(root);
}

/** The top-level element of the export that holds `el` (a direct child of `root`). */
function topLevelOf(el: HTMLElement, root: HTMLElement): HTMLElement | null {
	let cur: HTMLElement | null = el;
	while (cur && cur.parentElement !== root) cur = cur.parentElement;
	return cur;
}

/** The heading a top-level element is: itself, or its only child (blocks are wrapped in a div). */
function headingOf(block: HTMLElement): HTMLElement | null {
	if (HEADING.test(block.tagName)) return block;
	const only = block.childElementCount === 1 ? (block.firstElementChild as HTMLElement | null) : null;
	return only && HEADING.test(only.tagName) ? only : null;
}

function markPageBreaks(root: HTMLElement): void {
	// The paragraph of each image that floats, when that paragraph is a top-level block of this note.
	// Images inside lists, quotes, callouts, tables or a transcluded note are left to their container.
	const floatBlocks = new Map<HTMLElement, HTMLElement>();
	for (const img of Array.from(root.querySelectorAll<HTMLElement>(READING_IMAGES))) {
		const wrap = wrapFromAlt(img.getAttribute('alt'));
		if (wrap !== 'left' && wrap !== 'right') continue;
		const p = img.parentElement;
		if (!p || p.tagName !== 'P') continue;
		const block = topLevelOf(p, root);
		if (!block || (block !== p && p.parentElement !== block)) continue;
		floatBlocks.set(block, p);
	}
	if (floatBlocks.size === 0) return;
	const blocks = Array.from(root.children) as HTMLElement[];
	const kinds = blocks.map((block): PrintBlockKind =>
		floatBlocks.has(block) ? 'float' : headingOf(block) ? 'heading' : 'other',
	);
	keepWithNext(kinds).forEach((keep, i) => {
		const block = blocks[i];
		if (!keep || !block) return;
		block.addClass(PRINT_KEEP_CLASS);
		headingOf(block)?.addClass(PRINT_KEEP_CLASS);
	});
	for (const [block, p] of floatBlocks) {
		block.addClass(PRINT_FLOAT_CLASS);
		p.addClass(PRINT_FLOAT_CLASS);
	}
}
