// Plans moving one image link to the start of another block (drag to move). Pure, no Obsidian imports.
//
// The move is planned on the note's lines and returned as at most two text changes, both relative to
// the note as it was (CodeMirror applies them as one transaction, so one undo step):
//   1. the link leaves its old place: its line goes if nothing else is on it (with one surplus blank
//      line, so no double, leading or trailing blank line is left), otherwise only the link and one
//      space next to it go;
//   2. the link arrives on a line of its own above the target block, after a blank line. A wrapped
//      image is glued to the block it wraps (no blank line after it) unless that would change what the
//      block means in Markdown; an unwrapped image gets a paragraph of its own.
// Dropping where the image already is plans nothing, unless its side changed: then only the link is
// rewritten.
//
// The tidying of blank lines and the "anchor on the line before the target" idea follow Adjustable Media
// (src/layout/placement.ts insertion(), src/layout/edits.ts resolveEdits(), src/layout/plainEmbed.ts),
// MIT, (c) 2026 Yi-luo-hua.
import { dropTargets, scanLines, type LineInfo } from './lines';

export interface TextChange {
	from: number;
	to: number;
	insert: string;
}

export interface MoveRequest {
	/** Line index (0-based) of the dragged link. */
	line: number;
	/** Column range of the link on that line; `to` is exclusive. */
	from: number;
	to: number;
	/** A line index from dropTargets(); the line count stands for the end of the note. */
	target: number;
	/** The link as it should read at its new place (its side may have changed). */
	link: string;
	/** Wrapped images (left, right, top and bottom) are glued above the block they wrap. */
	wrapped: boolean;
}

export interface MovePlan {
	/** Ascending, non-overlapping, relative to the original text. Empty when nothing would change. */
	changes: TextChange[];
	/** The note's lines after the move. */
	lines: string[];
}

const isBlank = (s: string | undefined): boolean => s !== undefined && s.trim() === '';
const isSpace = (c: string | undefined): boolean => c === ' ' || c === '\t';

/** The lines [from, to) of the original are replaced by `replacement`. */
interface Removal {
	from: number;
	to: number;
	replacement: string[];
	/** When the link shared its line with text: the column span that goes. */
	span: [number, number] | null;
}

function planRemoval(lines: readonly string[], line: number, from: number, to: number): Removal {
	const text = lines[line]!;
	const before = text.slice(0, from);
	const after = text.slice(to);
	if ((before + after).trim() === '') {
		let a = line;
		let b = line + 1;
		if ((line === 0 || isBlank(lines[line - 1])) && isBlank(lines[line + 1])) b++;
		else if (line + 1 === lines.length && line > 0 && isBlank(lines[line - 1])) a--;
		return { from: a, to: b, replacement: [], span: null };
	}
	// The line keeps its other text: take the link and one space next to it. At the start of a line, take
	// every space after it, so the text cannot turn into an indented code block.
	let c0 = from;
	let c1 = to;
	if (before === '') while (isSpace(text[c1])) c1++;
	else if (isSpace(text[c1])) c1++;
	else if (isSpace(text[c0 - 1])) c0--;
	return { from: line, to: line + 1, replacement: [text.slice(0, c0) + text.slice(c1)], span: [c0, c1] };
}

/** How many lines the removal takes out. */
const removedCount = (r: Removal): number => r.to - r.from - r.replacement.length;

/** Where an original line index lands once the removal is done. */
function afterRemoval(index: number, r: Removal): number {
	if (index < r.from) return index;
	if (index >= r.to) return index - removedCount(r);
	return r.from;
}

/** The original line index in front of which a line inserted at `index` (after the removal) goes. */
function beforeRemoval(index: number, r: Removal): number {
	return index < r.from ? index : index + removedCount(r);
}

const BULLET_OR_ONE = /^(?:[-*+]|1[.)])[ \t]+\S/;
const HTML_START = /^ {0,3}<[A-Za-z!?/]/;
const DEFINITION = /^ {0,3}\[[^\]]+\]:/;

/**
 * True when an image line can sit directly above line `i` without changing what that block means.
 * Gluing makes the image line the first line of a paragraph, so the block must be one that may
 * interrupt a paragraph, and must not turn the image into part of something else.
 */
export function canGlueAbove(
	lines: readonly string[],
	infos: readonly LineInfo[],
	i: number,
	text: string | undefined = lines[i],
): boolean {
	const info = infos[i];
	if (!info || text === undefined) return false;
	switch (info.kind) {
		case 'heading':
		case 'quote':
		case 'fence':
			return true;
		case 'list':
			// Only bullet lists, and numbered lists that start at 1, may interrupt a paragraph.
			return BULLET_OR_ONE.test(text);
		case 'paragraph': {
			if (HTML_START.test(text) || DEFINITION.test(text)) return false;
			// A paragraph underlined with === or --- is a heading; glued, the image would join it.
			let k = i + 1;
			while (infos[k]?.kind === 'paragraph' && !infos[k]!.startsBlock) k++;
			return infos[k]?.kind !== 'setext-underline';
		}
		default:
			// Tables, rules (a glued "---" underlines the image), display math and anything else.
			return false;
	}
}

/** Lines to insert at `at` (an index into `rest`, the lines after the removal), and where they go. */
function planInsertion(
	rest: readonly string[],
	at: number,
	link: string,
	glue: (index: number) => boolean,
): { at: number; lines: string[] } {
	const m = rest.length;
	if (at >= m) {
		// End of the note: after one blank line, keeping a trailing newline if there is one.
		let k = m;
		while (k > 0 && isBlank(rest[k - 1])) k--;
		if (k === 0) return { at: 0, lines: [link] };
		const trailing = m - k;
		if (trailing === 0) return { at: m, lines: ['', link] };
		if (trailing === 1) return { at: k, lines: ['', link] };
		return { at: k + 1, lines: [link] };
	}
	const head = at === 0 || isBlank(rest[at - 1]) ? [] : [''];
	const tail = glue(at) ? [] : [''];
	return { at, lines: [...head, link, ...tail] };
}

/**
 * For each line: may a pointer resting over it drop the image at the nearest block start? Yes over
 * paragraphs, headings, rules, the first line of any block, and blank lines between blocks. No inside
 * code, math, comments, frontmatter, tables, quotes and callouts, and over list items after the first
 * (including the blank lines between them): those are places an image cannot go, so nothing is shown.
 */
export function dropZones(lines: readonly string[], infos: readonly LineInfo[] = scanLines(lines)): boolean[] {
	const out: boolean[] = new Array<boolean>(lines.length).fill(false);
	// Whether the next non-blank line starts a block; past the last line is the end of the note.
	let nextStarts = true;
	for (let i = lines.length - 1; i >= 0; i--) {
		const info = infos[i];
		if (!info) continue;
		if (info.kind === 'blank') {
			out[i] = info.context === 'text' && nextStarts;
			continue;
		}
		out[i] =
			info.startsBlock || (info.context === 'text' && (info.kind === 'paragraph' || info.kind === 'setext-underline'));
		nextStarts = info.startsBlock;
	}
	return out;
}

/** Applies changes (relative to `text`, ascending, non-overlapping) to `text`. */
export function applyChanges(text: string, changes: readonly TextChange[]): string {
	let out = '';
	let pos = 0;
	for (const c of changes) {
		out += text.slice(pos, c.from) + c.insert;
		pos = c.to;
	}
	return out + text.slice(pos);
}

/** One change covering everything that differs between two texts. */
function diffChange(a: string, b: string): TextChange {
	let start = 0;
	const max = Math.min(a.length, b.length);
	while (start < max && a[start] === b[start]) start++;
	let endA = a.length;
	let endB = b.length;
	while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
		endA--;
		endB--;
	}
	return { from: start, to: endA, insert: b.slice(start, endB) };
}

/**
 * Plans moving the link at `req.line`/`req.from..req.to` in front of `req.target`.
 * Returns null when the target is not a place an image may be dropped, or the request does not fit the note.
 */
export function planMove(
	lines: readonly string[],
	req: MoveRequest,
	infos: readonly LineInfo[] = scanLines(lines),
	targets: readonly number[] = dropTargets(lines, infos),
): MovePlan | null {
	const source = lines[req.line];
	if (source === undefined || req.from < 0 || req.to > source.length || req.from >= req.to) return null;
	if (!targets.includes(req.target)) return null;

	const removal = planRemoval(lines, req.line, req.from, req.to);
	const rest = [...lines.slice(0, removal.from), ...removal.replacement, ...lines.slice(removal.to)];
	const at = afterRemoval(req.target, removal);
	// The block's text as it will be (the link may have shared its first line), its kind as scanned.
	const glue = (index: number) => req.wrapped && canGlueAbove(lines, infos, beforeRemoval(index, removal), rest[index]);
	const insertion = planInsertion(rest, at, req.link, glue);
	const result = [...rest.slice(0, insertion.at), ...insertion.lines, ...rest.slice(insertion.at)];

	if (result.length === lines.length && result.every((l, i) => l === lines[i])) return { changes: [], lines: result };

	// Line starts in the original text, so lines map to offsets.
	const starts: number[] = [0];
	for (const l of lines) starts.push(starts[starts.length - 1]! + l.length + 1);
	const length = starts[lines.length]! - 1;
	const original = lines.join('\n');
	const wanted = result.join('\n');

	// Dropped where it already was, on the other side: only the link changes.
	const relinked = source.slice(0, req.from) + req.link + source.slice(req.to);
	if (result.length === lines.length && result.every((l, i) => (i === req.line ? l === relinked : l === lines[i]))) {
		const from = starts[req.line]! + req.from;
		return { changes: [{ from, to: starts[req.line]! + req.to, insert: req.link }], lines: result };
	}

	const changes: TextChange[] = [];
	if (removal.span) {
		const base = starts[req.line]!;
		changes.push({ from: base + removal.span[0], to: base + removal.span[1], insert: '' });
	} else if (removal.to < lines.length) {
		changes.push({ from: starts[removal.from]!, to: starts[removal.to]!, insert: '' });
	} else {
		changes.push({ from: removal.from > 0 ? starts[removal.from]! - 1 : 0, to: length, insert: '' });
	}
	const before = beforeRemoval(insertion.at, removal);
	const block = insertion.lines.join('\n');
	if (before >= lines.length) changes.push({ from: length, to: length, insert: `\n${block}` });
	else if (before > 0 && !(removal.span === null && before === removal.to)) {
		// Hung on the end of the line before, so a cursor at the start of the target block stays with its
		// text instead of ending up in front of the image. (Not when that line is being removed.)
		changes.push({ from: starts[before]! - 1, to: starts[before]! - 1, insert: `\n${block}` });
	} else changes.push({ from: starts[before]!, to: starts[before]!, insert: `${block}\n` });
	// Insertions before deletions at the same offset, so the inserted text lands in front.
	changes.sort((a, b) => a.from - b.from || (a.to - a.from) - (b.to - b.from));

	// The two changes must give exactly the planned text; if an edge case does not, fall back to one change.
	if (applyChanges(original, changes) !== wanted) return { changes: [diffChange(original, wanted)], lines: result };
	return { changes, lines: result };
}
