// Finds the one image link behind an embed element, by document position. Never by filename.
import type { Line, Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { findImageLinks, type ImageLink } from '../grammar';
import { scanLines, type LineInfo } from '../markdown/lines';

export interface LocatedLink {
	/** The link with `from`/`to` as document offsets. */
	link: ImageLink;
	line: Line;
	/** Why the toolbar or drag should not act on this link, or null when it may. */
	unsupported: string | null;
}

/** Decodes a link target the way Obsidian fills an embed's `src`, for a sanity check only. */
function sameTarget(linkTarget: string, src: string | null): boolean {
	if (src === null) return true;
	const norm = (s: string) => {
		let t = s.trim().replace(/^<|>$/g, '');
		try {
			t = decodeURI(t);
		} catch {
			/* keep as written */
		}
		return t.split('#')[0]!.split('|')[0]!.trim();
	};
	return norm(linkTarget) === norm(src);
}

/** The scanner's view of one line, computed from the whole note (context depends on what comes before). */
export function lineInfoAt(doc: Text, lineNumber: number): LineInfo | undefined {
	const lines = doc.toString().split('\n');
	return scanLines(lines)[lineNumber - 1];
}

/** Reasons a line's images are display only in v1. */
function unsupportedReason(info: LineInfo | undefined, lineText: string): string | null {
	if (!info) return 'unknown';
	if (info.context !== 'text') return 'not body text';
	switch (info.kind) {
		case 'table':
			return 'in a table';
		case 'quote':
			return 'in a quote or callout';
		case 'list':
		case 'indented':
			return 'in a list';
		case 'footnote':
			return 'in a footnote';
		case 'heading':
			return 'in a heading';
	}
	if (/^\s*\|/.test(lineText)) return 'in a table';
	return null;
}

/**
 * Maps an embed element in a Live Preview editor to its link. `posAtDOM` gives the start of the
 * widget; the link is the one that starts at (or covers) that column on its line.
 */
export function locateEmbed(view: EditorView, embed: HTMLElement): LocatedLink | null {
	let pos: number;
	try {
		pos = view.posAtDOM(embed);
	} catch {
		return null; // no longer part of this editor
	}
	return locateAt(view.state.doc, pos, embed.getAttribute('src'));
}

/** Finds the link that starts at, or covers, `pos`. `src` (optional) must match its target. */
export function locateAt(doc: Text, pos: number, src: string | null = null): LocatedLink | null {
	if (pos < 0 || pos > doc.length) return null;
	const line = doc.lineAt(pos);
	const inTable = /^\s*\|/.test(line.text);
	const links = findImageLinks(line.text, inTable);
	const col = pos - line.from;
	const found = links.find((l) => l.from === col) ?? links.find((l) => l.from <= col && col < l.to);
	if (!found || !sameTarget(found.target, src)) return null;
	const link: ImageLink = { ...found, from: line.from + found.from, to: line.from + found.to };
	return { link, line, unsupported: unsupportedReason(lineInfoAt(doc, line.number), line.text) };
}
