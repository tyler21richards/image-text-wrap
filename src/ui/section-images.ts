// Maps an image drawn in a Reading view section back to the link that wrote it, by order, never by filename.
// Pure, no Obsidian imports.
import { findImageLinks, looksLikeImage, type ImageLink } from '../grammar';

export interface SectionImageLink {
	/** 0-based line number in the note. */
	line: number;
	/** The link, with offsets relative to its line. */
	link: ImageLink;
}

/** Every image link written on lines `start`..`end` (inclusive, 0-based), in reading order. */
export function sectionImageLinks(lines: readonly string[], start: number, end: number): SectionImageLink[] {
	const out: SectionImageLink[] = [];
	for (let n = Math.max(0, start); n <= end && n < lines.length; n++) {
		const text = lines[n]!;
		if (!text.includes('![')) continue;
		for (const link of findImageLinks(text, /^\s*\|/.test(text))) {
			if (looksLikeImage(link.target)) out.push({ line: n, link });
		}
	}
	return out;
}

/**
 * The link behind the `index`-th image drawn in a section, when the section draws exactly as many images
 * as it has image links. Any disagreement (a link inside inline code, an image that failed to draw) gives
 * null, so the caller offers nothing rather than risk changing the wrong link. The caller still checks
 * the link's target against the drawn image.
 */
export function linkForDrawnImage(
	links: readonly SectionImageLink[],
	drawnCount: number,
	index: number,
): SectionImageLink | null {
	if (drawnCount !== links.length || index < 0 || index >= links.length) return null;
	return links[index]!;
}

/** Offset of the start of line `line` (0-based) in the text the lines were split from. */
export function lineOffset(lines: readonly string[], line: number): number {
	let offset = 0;
	for (let n = 0; n < line; n++) offset += lines[n]!.length + 1;
	return offset;
}
