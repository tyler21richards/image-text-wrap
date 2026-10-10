// Reads and writes layout tokens inside one image link. Pure functions, no Obsidian imports.
//
//   ![[photo.png|A caption|wrap-right|gap-24|300]]
//   ![A caption|wrap-block|300](photo.png)
//
// Order is: path | free text | layout tokens | size. Unknown segments keep their position.

export type Wrap = 'none' | 'left' | 'right' | 'block';
export type Gap = 0 | 8 | 16 | 24;

export interface Layout {
	wrap: Wrap;
	gap: Gap;
}

/** 16px is the spacing an image gets when its link has no gap token. */
export const DEFAULT_GAP: Gap = 16;
export const GAPS: readonly Gap[] = [0, 8, 16, 24];

export interface ImageLink {
	/** Offsets into the text the link was parsed from. `to` is exclusive. */
	from: number;
	to: number;
	kind: 'wiki' | 'markdown';
	/** The path or URL the link points at, exactly as written. */
	target: string;
	/** Segments between the path and the closing bracket, split on the separator. */
	segments: string[];
	/** "|" normally, "\\|" when the link sits in a table row and its pipes are escaped. */
	separator: '|' | '\\|';
	layout: Layout;
}

const WRAP_TOKENS: Record<string, Wrap> = {
	'wrap-left': 'left',
	'wrap-right': 'right',
	'wrap-block': 'block',
};
const GAP_TOKENS: Record<string, Gap> = { 'gap-0': 0, 'gap-8': 8, 'gap-16': 16, 'gap-24': 24 };

const SIZE = /^\s*\d+(\s*x\s*\d+)?\s*$/;

export function isSizeSegment(s: string): boolean {
	return SIZE.test(s);
}

export function isLayoutToken(s: string): boolean {
	const t = s.trim();
	return t in WRAP_TOKENS || t in GAP_TOKENS;
}

export function layoutFromSegments(segments: readonly string[]): Layout {
	let wrap: Wrap = 'none';
	let gap: Gap = DEFAULT_GAP;
	for (const raw of segments) {
		const s = raw.trim();
		if (s in WRAP_TOKENS) wrap = WRAP_TOKENS[s]!;
		else if (s in GAP_TOKENS) gap = GAP_TOKENS[s]!;
	}
	return { wrap, gap };
}

export function tokensFor(layout: Layout): string[] {
	if (layout.wrap === 'none') return [];
	const out = [`wrap-${layout.wrap}`];
	if (layout.gap !== DEFAULT_GAP) out.push(`gap-${layout.gap}`);
	return out;
}

/** Splits on "|" but not on "\|" (unless the separator is "\|" itself, as in table rows). */
function splitSegments(body: string, separator: '|' | '\\|'): string[] {
	if (separator === '\\|') return body.split('\\|');
	const out: string[] = [];
	let cur = '';
	for (let i = 0; i < body.length; i++) {
		const c = body[i];
		if (c === '\\' && body[i + 1] === '|') {
			cur += '\\|';
			i++;
		} else if (c === '|') {
			out.push(cur);
			cur = '';
		} else cur += c;
	}
	out.push(cur);
	return out;
}

/**
 * Parses the image link that starts exactly at `pos` in `text`.
 * `inTable` says the link is inside a table row, where Obsidian writes pipes as "\|".
 * Returns null when there is no image embed at `pos`.
 */
export function parseImageLinkAt(text: string, pos: number, inTable = false): ImageLink | null {
	if (text.startsWith('![[', pos)) return parseWiki(text, pos, inTable);
	if (text.startsWith('![', pos)) return parseMarkdown(text, pos, inTable);
	return null;
}

function lineEnd(text: string, pos: number): number {
	const nl = text.indexOf('\n', pos);
	return nl === -1 ? text.length : nl;
}

function parseWiki(text: string, pos: number, inTable: boolean): ImageLink | null {
	const end = text.indexOf(']]', pos + 3);
	if (end === -1 || end > lineEnd(text, pos)) return null;
	const inner = text.slice(pos + 3, end);
	const separator = inTable && inner.includes('\\|') ? '\\|' : '|';
	const parts = splitSegments(inner, separator);
	const target = parts[0] ?? '';
	if (!target.trim()) return null;
	const segments = parts.slice(1);
	return {
		from: pos,
		to: end + 2,
		kind: 'wiki',
		target,
		segments,
		separator,
		layout: layoutFromSegments(segments),
	};
}

function parseMarkdown(text: string, pos: number, inTable: boolean): ImageLink | null {
	const stop = lineEnd(text, pos);
	// Alt text: up to the matching "]", allowing nested brackets and escapes.
	let depth = 0;
	let i = pos + 2;
	for (; i < stop; i++) {
		const c = text[i];
		if (c === '\\') {
			i++;
			continue;
		}
		if (c === '[') depth++;
		else if (c === ']') {
			if (depth === 0) break;
			depth--;
		}
	}
	if (i >= stop || text[i + 1] !== '(') return null;
	const alt = text.slice(pos + 2, i);
	// Destination: "<...>" or a run without unbalanced ")" or whitespace, then an optional title.
	let j = i + 2;
	let target: string;
	if (text[j] === '<') {
		const close = text.indexOf('>', j);
		if (close === -1 || close > stop) return null;
		target = text.slice(j + 1, close);
		j = close + 1;
	} else {
		let paren = 0;
		const start = j;
		for (; j < stop; j++) {
			const c = text[j];
			if (c === '\\') {
				j++;
				continue;
			}
			if (c === '(') paren++;
			else if (c === ')') {
				if (paren === 0) break;
				paren--;
			} else if (c === ' ' || c === '\t') break;
		}
		target = text.slice(start, j);
	}
	// Skip an optional title and find the closing ")".
	const close = findClosingParen(text, j, stop);
	if (close === -1 || !target) return null;
	const separator = inTable && alt.includes('\\|') ? '\\|' : '|';
	const segments = alt === '' ? [] : splitSegments(alt, separator);
	return {
		from: pos,
		to: close + 1,
		kind: 'markdown',
		target,
		segments,
		separator,
		layout: layoutFromSegments(segments),
	};
}

function findClosingParen(text: string, from: number, stop: number): number {
	let quote: string | null = null;
	for (let k = from; k < stop; k++) {
		const c = text[k];
		if (quote) {
			if (c === '\\') k++;
			else if (c === quote) quote = null;
		} else if (c === '"' || c === "'") quote = c;
		else if (c === ')') return k;
	}
	return -1;
}

/** Returns the segments with layout tokens replaced, keeping every other segment where it was. */
export function withLayout(segments: readonly string[], layout: Layout): string[] {
	const tokens = tokensFor(layout);
	const out: string[] = [];
	let placed = false;
	for (const s of segments) {
		if (isLayoutToken(s)) {
			if (!placed) {
				out.push(...tokens);
				placed = true;
			}
			continue;
		}
		out.push(s);
	}
	if (!placed && tokens.length) {
		// Before a trailing size, otherwise at the end.
		const last = out.length - 1;
		const at = last >= 0 && isSizeSegment(out[last]!) ? last : out.length;
		out.splice(at, 0, ...tokens);
	}
	return out;
}

/** Writes the link back out with new segments. Everything outside the segments is copied as written. */
export function serializeLink(text: string, link: ImageLink, segments: readonly string[]): string {
	const raw = text.slice(link.from, link.to);
	const body = segments.join(link.separator);
	if (link.kind === 'wiki') {
		return `![[${link.target}${segments.length ? link.separator + body : ''}]]`;
	}
	// Keep the destination and title exactly as written.
	const altEnd = findAltEnd(raw);
	return `![${body}${raw.slice(altEnd)}`;
}

function findAltEnd(raw: string): number {
	let depth = 0;
	for (let i = 2; i < raw.length; i++) {
		const c = raw[i];
		if (c === '\\') {
			i++;
			continue;
		}
		if (c === '[') depth++;
		else if (c === ']') {
			if (depth === 0) return i;
			depth--;
		}
	}
	return raw.length;
}

/** The text of the link with its layout set. */
export function relayout(text: string, link: ImageLink, layout: Layout): string {
	return serializeLink(text, link, withLayout(link.segments, layout));
}

const IMAGE_EXT = /\.(avif|bmp|gif|jpe?g|png|svg|webp|heic|tiff?)$/i;

/** True when the link target looks like an image (by extension), or is a remote or data URL. */
export function looksLikeImage(target: string): boolean {
	const clean = target.split('#')[0]!.split('?')[0]!.trim();
	return IMAGE_EXT.test(clean) || /^data:image\//i.test(target) || /^https?:\/\//i.test(target);
}

/**
 * Finds every image link on a line of text (offsets relative to the line).
 * Used to recognise lines that hold nothing but one wrapped image.
 */
export function findImageLinks(line: string, inTable = false): ImageLink[] {
	const out: ImageLink[] = [];
	let i = 0;
	while ((i = line.indexOf('![', i)) !== -1) {
		if (i > 0 && line[i - 1] === '\\') {
			i += 2;
			continue;
		}
		const link = parseImageLinkAt(line, i, inTable);
		if (link) {
			out.push(link);
			i = link.to;
		} else i += 2;
	}
	return out;
}

/** True when a token could be one of ours: any wrap-* or gap-* segment, for cheap note-level checks. */
export const ANY_LAYOUT_TOKEN = /[|[]\s*wrap-(left|right|block)\s*[|\]]/;
