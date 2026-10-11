// The layout choices offered by the toolbar, the right-click menu and the commands. Pure, no Obsidian imports.
import { DEFAULT_GAP, findImageLinks, looksLikeImage, type Gap, type ImageLink, type Layout, type Wrap } from '../grammar';

/** Icon ids registered by src/icons.ts. */
export const ICON = {
	inline: 'itw-in-line',
	left: 'itw-wrap-left',
	right: 'itw-wrap-right',
	block: 'itw-top-and-bottom',
	spacing: 'itw-spacing',
} as const;

export interface WrapChoice {
	wrap: Wrap;
	/** Button tooltip and menu title. */
	label: string;
	/** The label shown under the icon on phones and tablets, where buttons carry visible text. */
	short: string;
	icon: string;
}

/** In the order of Word's Layout Options. */
export const WRAP_CHOICES: readonly WrapChoice[] = [
	{ wrap: 'none', label: 'In line with text', short: 'In line', icon: ICON.inline },
	{ wrap: 'left', label: 'Wrap text left', short: 'Wrap left', icon: ICON.left },
	{ wrap: 'right', label: 'Wrap text right', short: 'Wrap right', icon: ICON.right },
	{ wrap: 'block', label: 'Top and bottom', short: 'Top and bottom', icon: ICON.block },
];

export const SPACING_LABEL = 'Spacing';
export const SPACING_DISABLED_LABEL = 'Spacing (choose a wrap option first)';

/** The spacing choices as the phone and tablet sheet shows them: one segment each, smallest first. */
export const SPACING_CHOICES: readonly { gap: Gap; label: string }[] = [
	{ gap: 0, label: 'None' },
	{ gap: 8, label: 'Small' },
	{ gap: 16, label: 'Medium' },
	{ gap: 24, label: 'Large' },
];

/** Shown beside "Spacing" on the sheet while the picture is in line, where spacing does not apply. */
export const SPACING_HINT = 'Choose a wrap option first';
/** The sheet's name for screen readers. */
export const SHEET_LABEL = 'Picture layout';

/**
 * The layout after a toolbar or menu click on a wrap choice. Clicking the active wrap choice turns
 * wrapping off, which is the on/off toggle. Turning wrapping on from in line uses the default spacing;
 * switching sides keeps the spacing the image already has.
 */
export function layoutAfterWrapClick(current: Layout, wrap: Wrap, defaultGap: Gap): Layout {
	if (wrap === 'none' || current.wrap === wrap) return { wrap: 'none', gap: DEFAULT_GAP };
	if (current.wrap === 'none') return { wrap, gap: defaultGap };
	return { wrap, gap: current.gap };
}

/** The layout a "wrap: …" command sets, or null when the image already has it (the command does not apply). */
export function layoutForWrapCommand(current: Layout, wrap: Wrap, defaultGap: Gap): Layout | null {
	if (current.wrap === wrap) return null;
	return layoutAfterWrapClick(current, wrap, defaultGap);
}

/** The layout with new spacing, or null when spacing does not apply (in line) or is already set. */
export function layoutForGap(current: Layout, gap: Gap): Layout | null {
	if (current.wrap === 'none' || current.gap === gap) return null;
	return { wrap: current.wrap, gap };
}

/**
 * True when `after` is `before` with only the inside of its image links changed: the same links, in the
 * same order, to the same targets, and the same text around them. A layout change looks like this.
 */
export function onlyImageLinksChanged(before: string, after: string): boolean {
	if (before === after) return false;
	const a = findImageLinks(before, /^\s*\|/.test(before));
	const b = findImageLinks(after, /^\s*\|/.test(after));
	if (a.length === 0 || a.length !== b.length) return false;
	const around = (text: string, links: readonly ImageLink[]) => {
		let out = '';
		let at = 0;
		for (const link of links) {
			out += `${text.slice(at, link.from)}\u0000`;
			at = link.to;
		}
		return out + text.slice(at);
	};
	return around(before, a) === around(after, b) && a.every((link, i) => link.target === b[i]!.target);
}

/**
 * The image link a command acts on when no image is selected: the one under the cursor (or touching it),
 * else the only image link on the line. `col` is the cursor's offset in the line.
 */
export function pickLinkAtCursor(lineText: string, col: number, inTable = false): ImageLink | null {
	const links = findImageLinks(lineText, inTable).filter((l) => looksLikeImage(l.target));
	const under = links.find((l) => l.from <= col && col <= l.to);
	if (under) return under;
	return links.length === 1 ? links[0]! : null;
}
