// Reads and writes layout tokens inside one image link. Pure functions, no Obsidian imports.
//
//   ![[photo.png|A caption|wrap-right|gap-24|300]]
//   ![A caption|wrap-block|300](photo.png)
//
// Order is: path | free text | layout tokens | size. Unknown segments keep their position.
//
// Where Obsidian's two views disagree on what is an image or a token, these functions follow the
// stricter one, so the plugin never acts on something one view does not draw as a wrapped image.

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

/** True when `s` is exactly a layout token: no spaces around it, lower case, as styles.css matches it. */
export function isLayoutToken(s: string): boolean {
	return s in WRAP_TOKENS || s in GAP_TOKENS;
}

/** The layout of exact tokens among `segments` (a link's visible segments, or the parts of an alt text). */
export function layoutFromSegments(segments: readonly string[]): Layout {
	let wrap: Wrap = 'none';
	let gap: Gap = DEFAULT_GAP;
	for (const s of segments) {
		if (s in WRAP_TOKENS) wrap = WRAP_TOKENS[s]!;
		else if (s in GAP_TOKENS) gap = GAP_TOKENS[s]!;
	}
	return { wrap, gap };
}

/**
 * Each segment as styles.css sees it in the embed's alt text. Obsidian copies the segments into the alt
 * text without a size at the end, and trims spaces off the start of it, and off its end when no size
 * follows; styles.css then matches tokens as exact "|"-separated parts. So "| wrap-left|300" is a token,
 * but "| wrap-left |300" and "A caption | wrap-left" are not: Live Preview keeps those spaces and draws
 * the image in line (Reading view trims the space before a size, the one case where the views differ).
 */
function visibleSegments(segments: readonly string[]): string[] {
	const sized = segments.length > 0 && isSizeSegment(segments[segments.length - 1]!);
	const trimEnd = sized ? -1 : segments.length - 1;
	return segments.map((s, i) => {
		const start = i === 0 ? s.trimStart() : s;
		return i === trimEnd ? start.trimEnd() : start;
	});
}

/** The layout a link's segments give its image. */
function layoutOfLink(segments: readonly string[]): Layout {
	return layoutFromSegments(visibleSegments(segments));
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
		layout: layoutOfLink(segments),
	};
}

/**
 * Where the alt text of a markdown image that starts at `pos` ends (the index of its "]"), or -1 when
 * Obsidian does not draw an image there. Live Preview ends the alt text at the first "]", escaped or
 * not, and Reading view needs every "[" in it escaped (an unescaped one would need a matching "]").
 */
function altEnd(text: string, pos: number, stop: number): number {
	for (let i = pos + 2; i < stop; i++) {
		const c = text[i];
		if (c === '\\') {
			if (text[i + 1] === ']') return -1;
			i++;
		} else if (c === '[') return -1;
		else if (c === ']') return i;
	}
	return -1;
}

function parseMarkdown(text: string, pos: number, inTable: boolean): ImageLink | null {
	const stop = lineEnd(text, pos);
	const i = altEnd(text, pos, stop);
	if (i === -1 || text[i + 1] !== '(') return null;
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
		layout: layoutOfLink(segments),
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
	const visible = visibleSegments(segments);
	const out: string[] = [];
	let placed = false;
	segments.forEach((s, i) => {
		if (isLayoutToken(visible[i]!)) {
			if (!placed) {
				out.push(...tokens);
				placed = true;
			}
			return;
		}
		out.push(s);
	});
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
	const end = altEnd(raw, 0, raw.length);
	return `![${body}${raw.slice(end === -1 ? raw.length : end)}`;
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

/** End (exclusive) of the code span whose backtick run starts at `i`. */
function codeSpanEnd(line: string, i: number): number {
	let n = 0;
	while (line[i + n] === '`') n++;
	for (let j = line.indexOf('`', i + n); j !== -1; ) {
		let m = 0;
		while (line[j + m] === '`') m++;
		if (m === n) return j + m;
		j = line.indexOf('`', j + m);
	}
	// Not closed on this line: Live Preview shows the rest of the line as code (Reading view as text).
	return line.length;
}

const SPACE = /\s/;
const DIGIT = /\d/;

/** End (exclusive) of the inline math that starts with the "$" at `i`, or -1 when that "$" is plain text. */
function mathEnd(line: string, i: number): number {
	if (line[i + 1] === '$') {
		// Not closed on this line: Live Preview starts a block of math there (Reading view shows text).
		const close = line.indexOf('$$', i + 2);
		return close === -1 ? line.length : close + 2;
	}
	// "$x$": no space after the opening "$" or before the closing one, and no digit after the closing one.
	const first = line[i + 1];
	if (first === undefined || SPACE.test(first)) return -1;
	for (let k = line.indexOf('$', i + 2); k !== -1; k = line.indexOf('$', k + 1)) {
		const before = line[k - 1]!;
		if (SPACE.test(before) || before === '\\' || DIGIT.test(line[k + 1] ?? '')) continue;
		return k + 1;
	}
	return -1;
}

/**
 * End (exclusive) of inline code, inline math or a one-line comment that starts at `i`, or -1.
 * Obsidian draws no image inside these: an image link there is text (Live Preview draws one inside
 * %%…%%, but the comment is hidden everywhere else).
 */
function literalSpanEnd(line: string, i: number): number {
	const c = line[i];
	if (c === '`') return codeSpanEnd(line, i);
	if (c === '$') return mathEnd(line, i);
	if (c === '%' && line[i + 1] === '%') {
		const close = line.indexOf('%%', i + 2);
		return close === -1 ? -1 : close + 2;
	}
	if (c === '<' && line.startsWith('<!--', i)) {
		const close = line.indexOf('-->', i + 4);
		return close === -1 ? line.length : close + 3;
	}
	return -1;
}

const SPECIAL = /[\\`$%<!]/g;

/**
 * Finds every image link on a line of text (offsets relative to the line), reading it from left to
 * right as Obsidian does: a backslash escapes the next character, and links inside inline code, inline
 * math and one-line comments are not images. Every part of the plugin that looks for links in text
 * goes through this.
 */
export function findImageLinks(line: string, inTable = false): ImageLink[] {
	const out: ImageLink[] = [];
	let i = 0;
	while (i < line.length) {
		SPECIAL.lastIndex = i;
		const found = SPECIAL.exec(line);
		if (!found) break;
		i = found.index;
		if (line[i] === '\\') {
			i += 2;
			continue;
		}
		const end = literalSpanEnd(line, i);
		if (end !== -1) {
			i = end;
			continue;
		}
		const link = line[i] === '!' ? parseImageLinkAt(line, i, inTable) : null;
		if (link) {
			out.push(link);
			i = link.to;
		} else i++;
	}
	return out;
}

/**
 * True when a line could hold one of our wrap tokens, for cheap note-level checks. It also matches
 * segments with spaces that are not tokens (see visibleSegments); findImageLinks gives the exact answer.
 */
export const ANY_LAYOUT_TOKEN = /[|[][ \t]*wrap-(?:left|right|block)[ \t]*[|\]]/;
