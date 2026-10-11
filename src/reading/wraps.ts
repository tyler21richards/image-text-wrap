// What Reading view and PDF export need to know about a note's wrapped images. Pure, no Obsidian imports.
import { findImageLinks, layoutFromSegments, parseImageLinkAt, type Layout, type Wrap } from '../grammar';
import { scanLines } from '../markdown/lines';

/** Only images that float (wrap left or right) need the text-beside-a-float fixes. */
const FLOATS: ReadonlySet<Wrap> = new Set(['left', 'right']);
const QUICK = /wrap-(?:left|right)/;

/**
 * True when the note has at least one image wrapped left or right, outside code, math, comments,
 * frontmatter and tables (a table cell keeps its image to itself).
 */
export function textHasFloat(text: string): boolean {
	if (!QUICK.test(text)) return false;
	const lines = text.split('\n');
	const infos = scanLines(lines);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		if (!QUICK.test(line)) continue;
		const info = infos[i];
		if (!info || info.context !== 'text' || info.kind === 'table') continue;
		if (findImageLinks(line).some((link) => FLOATS.has(link.layout.wrap))) return true;
	}
	return false;
}

/**
 * True when one embed's original text (as Obsidian's metadata cache keeps it, `![[photo.png|wrap-left|300]]`)
 * wraps left or right.
 */
export function embedHasFloat(original: string): boolean {
	if (!QUICK.test(original)) return false;
	const link = parseImageLinkAt(original, 0, original.includes('\\|'));
	return !!link && FLOATS.has(link.layout.wrap);
}

/** The layout of a rendered image from its alt attribute ("A caption|wrap-right|gap-24"), as styles.css reads it. */
export function layoutFromAlt(alt: string | null): Layout {
	return layoutFromSegments(alt ? alt.split('|') : []);
}

/** The wrap of a rendered image from its alt attribute ("A caption|wrap-right"), as styles.css reads it. */
export function wrapFromAlt(alt: string | null): Wrap {
	if (!alt) return 'none';
	return layoutFromAlt(alt).wrap;
}

/** What a top-level element of a PDF export is, as far as page breaks go. */
export type PrintBlockKind = 'heading' | 'float' | 'other';

/**
 * Which top-level elements of the export a page break must not part from the next one: a heading
 * right before a block that holds a floating image. Chromium moves a float that does not fit on the
 * page to the next page alone, leaving its text behind; kept whole, the float's block moves instead,
 * and its heading goes with it.
 *
 * Adapted from Adjustable Media (src/markdown/print.ts, keepWithNext), MIT, (c) 2026 Yi-luo-hua.
 * Unlike there, two floats in a row are not chained: here a float's block also holds its paragraph.
 */
export function keepWithNext(kinds: readonly PrintBlockKind[]): boolean[] {
	return kinds.map((kind, i) => kind === 'heading' && kinds[i + 1] === 'float');
}
