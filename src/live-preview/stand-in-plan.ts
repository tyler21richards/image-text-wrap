// Plans stand-ins for wrapped images whose own line CodeMirror is not drawing (brief 7 item 6).
// Pure: works on numbers measured elsewhere and on CodeMirror documents, no DOM and no Obsidian
// imports, so it is unit tested.
//
// CodeMirror draws only the part of a note near the window. When a wrapped image's line lies above
// the first drawn line but the picture is tall enough to reach into the drawn part, the lines beside
// it lose their wrap, and jump once the image's line is drawn again. A stand-in is a display-only copy
// of the picture, floated to the same side with the same size, placed in front of the first drawn
// line and shifted up by as much as the real picture starts above that line.
//
// planStandIn, liveStandIn, stackStandIns and standInAnchorTop are adapted from Adjustable Media
// (src/layout/wrapGaps.ts: planProxy, liveProxy, stackProxies, standInAnchorTop), MIT,
// (c) 2026 Yi-luo-hua.

import type { ChangeDesc, Text } from '@codemirror/state';
import { findImageLinks, isSizeSegment, type ImageLink } from '../grammar';
import { isPlainLine, lastLineAffected, opensOrCloses, scanLines } from '../markdown/lines';

export type FloatSide = 'left' | 'right';

/** An image wrapped left or right in body text: its picture floats out of its line. */
export interface FloatAnchor {
	/** 0-based line index. */
	line: number;
	/** Offsets of the link within the line. */
	linkFrom: number;
	linkTo: number;
	/** The link exactly as written; a cached size is only trusted while this is unchanged. */
	raw: string;
	side: FloatSide;
	gap: number;
	link: ImageLink;
	/**
	 * The line holds nothing but images wrapped left or right (one, or several), so it takes no height
	 * (styles.css) and a picture never drawn can be placed from it. A picture that shares its line with
	 * text, or with an image in line, starts wherever it lands in that line: it is only known once drawn.
	 */
	alone: boolean;
}

/**
 * Images wrapped left or right in body text: on a line of their own, on a line of several wrapped
 * images, or inside a sentence. Lines in code, math, comments, frontmatter, lists, quotes, footnotes,
 * tables and headings are left out: there the picture either does not float or stays inside its line.
 */
export function findFloatAnchors(lines: readonly string[]): FloatAnchor[] {
	const out: FloatAnchor[] = [];
	let infos: ReturnType<typeof scanLines> | null = null;
	lines.forEach((text, line) => {
		// Every anchor line holds one of these; editKeepsAnchors relies on that.
		if (!text.includes('wrap-left') && !text.includes('wrap-right')) return;
		const links = findImageLinks(text);
		const floats = links.filter((link) => link.layout.wrap === 'left' || link.layout.wrap === 'right');
		if (floats.length === 0) return;
		infos ??= scanLines(lines);
		const info = infos[line];
		if (!info || info.context !== 'text' || info.kind !== 'paragraph') return;
		// The rule of the line classes (line-classes.ts): nothing but these images and spaces.
		const alone =
			floats.length === links.length &&
			!text.slice(links[links.length - 1]!.to).trim() &&
			links.every((link, i) => !text.slice(i === 0 ? 0 : links[i - 1]!.to, link.from).trim());
		for (const link of floats) {
			out.push({
				line,
				linkFrom: link.from,
				linkTo: link.to,
				raw: text.slice(link.from, link.to),
				side: link.layout.wrap as FloatSide,
				gap: link.layout.gap,
				link,
				alone,
			});
		}
	});
	return out;
}

/** Text that could open or close code, math, a comment or a table, or be a wrapped image line. */
const MAY_CHANGE_CONTEXT = /wrap-left|wrap-right|\||`{3}|~{3}|\$\$|%%|<!--|-->/i;
/** A frontmatter fence ("---" or "..."). */
const FRONTMATTER_FENCE = /^(?:---|\.\.\.)\s*$/;
/** A table's delimiter row without pipes ("---", ":-:"): the line above it, if it has a pipe, is a table's header. */
const BARE_DELIMITER = /^\s*:?-+:?\s*$/;
/** Lines that end a table in scanLines: blank lines, headings, rules, quotes and list items. */
const MAY_END_TABLE = /^(?:\s*$|[#>*+_-]|\d| {1,3}>)/;

/** Edited lines of a note, as they were or as they are, with the unchanged line on each side. */
export interface EditedLines {
	lines: readonly string[];
	/** The line before them, unless they start the note. */
	above?: string;
	/** The line after them, unless they end the note. */
	below?: string;
}

/**
 * Whether an edit cannot have changed which lines of the note are float anchors, nor any anchor's
 * text, so the anchors found before it only move. `before` and `after` are the edited lines as they
 * were and as they are.
 *
 * An anchor's line depends on its own text, on the next line (a table's delimiter row makes a line
 * with a pipe a table's header), on code, math, comments and frontmatter opened above it, and on
 * whether a table above it has ended. So no edited line may hold, or have held, a wrap, a pipe, a
 * delimiter row or a code, math, comment or frontmatter fence, the edit may not touch the note's
 * first line (where frontmatter starts), and it must leave the question "has a table ended by here"
 * as it was: both sides hold a blank line, which ends any table, or neither holds a line that could
 * end one (the unchanged lines around count too). The lines around may be anchors themselves: the
 * one above only depends on the edit through a delimiter row, the one below through a table's end.
 */
export function editKeepsAnchors(before: EditedLines, after: EditedLines, touchesFirstLine: boolean): boolean {
	if (touchesFirstLine) return false;
	const risky = (line: string) => MAY_CHANGE_CONTEXT.test(line) || FRONTMATTER_FENCE.test(line) || BARE_DELIMITER.test(line);
	if (before.lines.some(risky) || after.lines.some(risky)) return false;
	const all = (e: EditedLines) => [e.above, ...e.lines, e.below].filter((line): line is string => line !== undefined);
	const blank = (e: EditedLines) => all(e).some((line) => line.trim() === '');
	const mayEnd = (e: EditedLines) => all(e).some((line) => MAY_END_TABLE.test(line));
	return (blank(before) && blank(after)) || (!mayEnd(before) && !mayEnd(after));
}

/** A float anchor with document positions. */
export interface DocAnchor extends FloatAnchor {
	lineFrom: number;
	lineTo: number;
	/** Document position of the link: where CodeMirror puts the image widget. */
	pos: number;
}

/** The float anchors of a document. */
export function docAnchors(doc: Text): DocAnchor[] {
	let any = false;
	for (const iter = doc.iterLines(); !iter.next().done; ) {
		if (iter.value.includes('wrap-left') || iter.value.includes('wrap-right')) {
			any = true;
			break;
		}
	}
	if (!any) return [];
	return findFloatAnchors(doc.toString().split('\n')).map((found) => {
		const line = doc.line(found.line + 1);
		return { ...found, lineFrom: line.from, lineTo: line.to, pos: line.from + found.linkFrom };
	});
}

/**
 * Whether an edit of lines that are not all plain text can change how a wrapped image line below it is
 * read: a list item, quote or footnote that the edit opens or closes reaches the lines below it that
 * continue it without a marker (lastLineAffected).
 */
function reachesWrapBelow(was: EditedLines, now: EditedLines, doc: Text, to: number): boolean {
	if (was.lines.every(isPlainLine) && now.lines.every(isPlainLine)) return false;
	const n = doc.lineAt(to).number;
	const last = lastLineAffected(n, doc.lines, (k) => doc.line(k).text);
	for (let k = n + 1; k <= last; k++) if (/wrap-(?:left|right)/.test(doc.line(k).text)) return true;
	return false;
}

/** Edits with more separate changes than this (a replace-all) are left to a new scan. */
const MAX_MOVED_CHANGES = 8;

/** The lines `from`..`to` touch, with the line on each side. */
function editedLines(doc: Text, from: number, to: number): EditedLines {
	const first = doc.lineAt(from).number;
	const last = doc.lineAt(to).number;
	const lines: string[] = [];
	for (let n = first; n <= last; n++) lines.push(doc.line(n).text);
	return {
		lines,
		above: first > 1 ? doc.line(first - 1).text : undefined,
		below: last < doc.lines ? doc.line(last + 1).text : undefined,
	};
}

/**
 * The float anchors of `doc` from those of `startDoc` (`before`), when the edit between them
 * (`changes`) cannot have changed any (editKeepsAnchors): the same lines, moved. Only the edited lines
 * are read. Null when the note has to be scanned again (docAnchors).
 */
export function moveAnchors(before: readonly DocAnchor[], startDoc: Text, changes: ChangeDesc, doc: Text): DocAnchor[] | null {
	let ranges = 0;
	let kept = true;
	changes.iterChangedRanges((fromA, toA, fromB, toB) => {
		if (!kept) return;
		if (++ranges > MAX_MOVED_CHANGES) {
			kept = false;
			return;
		}
		const was = editedLines(startDoc, fromA, toA);
		const now = editedLines(doc, fromB, toB);
		kept = editKeepsAnchors(was, now, was.above === undefined || now.above === undefined) && !reachesWrapBelow(was, now, doc, toB);
	});
	if (!kept) return null;
	// Each anchor's own line is unchanged, so only its position moves.
	return before.map((anchor) => {
		const line = doc.lineAt(changes.mapPos(anchor.lineFrom));
		return { ...anchor, line: line.number - 1, lineFrom: line.from, lineTo: line.to, pos: line.from + anchor.linkFrom };
	});
}

/** The size segment of a link ("300" or "300x200"), if it has one. */
export function linkSize(link: ImageLink): { width: number; height?: number } | null {
	const last = link.segments[link.segments.length - 1];
	return last !== undefined && isSizeSegment(last) ? parseSize(last) : null;
}

/** A wrapped image's float as drawn, in CSS pixels, relative to its own line in the height map. */
export interface FloatBox {
	side: FloatSide;
	/** From the top of the image's line to the top of the image's border box. */
	layoutTop: number;
	/** Border box of the image embed. */
	width: number;
	height: number;
	/** Margin between the picture and the text beside it. */
	margin: number;
	/** Distance from the edge of the note column (on the picture's side) to the picture's border box. */
	inset: number;
	marginTop: number;
	marginBottom: number;
	/**
	 * The line the picture starts beside (its document position) and how far below that line's top.
	 * The stand-in follows that line rather than the image's own line, because lines between the two
	 * may change height while undrawn. Adjustable Media measured the text moving by up to 160px
	 * without this (docs/DESIGN.md 4.1).
	 */
	refPos?: number;
	refOffset?: number;
}

export interface StandInPlan {
	/** Height of an empty, zero-width float above the copy, when the picture starts below the line. */
	sandbag: number;
	/** How much of the picture lies above the line and is cut off. */
	shift: number;
	/** Height from the line's top to the bottom of the picture's margin box. */
	height: number;
	/** Top margin the copy is drawn with: its own, or negative to pull it up over the line. */
	marginTop: number;
}

/** Below this many pixels of overlap a float does not reach a line. */
const TOLERANCE = 1;

/**
 * Where the image's line is taken to be: from the line the picture starts beside, now at `refTop`,
 * when the picture was measured with one; else the image's own line at `anchorTop`.
 */
export function standInAnchorTop(box: FloatBox, anchorTop: number, refTop: number | null): number {
	return refTop !== null && box.refOffset !== undefined ? refTop + box.refOffset - box.layoutTop : anchorTop;
}

/**
 * The stand-in for a picture whose line starts at `anchorTop`, in front of a line starting at
 * `lineTop` (both in height-map pixels): the part of the picture at or below that line, or null
 * when the picture ends above it.
 */
export function planStandIn(anchorTop: number, box: FloatBox, lineTop: number): StandInPlan | null {
	const top = anchorTop + box.layoutTop;
	const bottom = top + box.height + box.marginBottom;
	if (bottom <= lineTop + TOLERANCE) return null;
	const visibleTop = Math.max(top, lineTop);
	const shift = visibleTop - top;
	const plan = { sandbag: Math.max(0, top - lineTop), shift, height: bottom - visibleTop };
	// The copy keeps the picture's own top margin, so its margin box sits where the real one does; the
	// sandbag holds only the rest. A list item laid out on its own narrows as soon as it overlaps the
	// float by one pixel (Adjustable Media measured 4px moving the note by 96px).
	if (shift > 0) return { ...plan, marginTop: -shift };
	const marginTop = box.marginTop;
	return plan.sandbag >= marginTop
		? { ...plan, sandbag: plan.sandbag - marginTop, marginTop }
		: { ...plan, sandbag: 0, marginTop: plan.sandbag };
}

/**
 * Stand-ins in front of one line, in document order. CSS never places a float higher than one
 * before it, so each sandbag starts where the earlier stand-ins start, not at the line: it holds only
 * what is left below them. `floor` is where floats drawn before the line already start below it (a
 * picture whose line CodeMirror draws apart because the cursor is on it).
 */
export function stackStandIns<Plan extends StandInPlan>(plans: readonly Plan[], floor = 0): Plan[] {
	return plans.map((plan) => {
		if (plan.shift > 0) return plan;
		const sandbag = Math.max(0, plan.sandbag - floor);
		floor = Math.max(floor, plan.sandbag);
		return { ...plan, sandbag };
	});
}

/** A size as written in an image link: "300" or "300x200". */
export function parseSize(segment: string | undefined): { width: number; height?: number } | null {
	const m = segment?.trim().match(/^(\d+)(?:\s*x\s*(\d+))?$/);
	if (!m) return null;
	const width = Number(m[1]);
	return m[2] === undefined ? { width } : { width, height: Number(m[2]) };
}

export interface EstimateInput {
	side: FloatSide;
	/** Size written in the link, if any. */
	size: { width: number; height?: number } | null;
	/** The picture's own size, once loaded. */
	natural: { width: number; height: number } | null;
	/** Width of a line's content box in the note column. */
	lineWidth: number;
	/** Inset of a line's content box from the note column's edge. */
	lineInset: number;
	/** Widest a wrapped picture is shown, as a percentage of the line. */
	maxPercent: number;
	gap: number;
	marginBottom: number;
}

/**
 * The float of a picture never drawn in this editor, as styles.css lays it out: as wide as its
 * stored size (or its own width), at most `maxPercent` of the line, keeping its aspect ratio.
 * Null when there is nothing to take the aspect ratio from yet.
 */
export function estimateBox(input: EstimateInput): FloatBox | null {
	const { size, natural } = input;
	const ratio = natural && natural.width > 0 ? natural.height / natural.width : size?.height ? size.height / size.width : null;
	if (ratio === null) return null;
	const own = size?.width ?? natural?.width ?? 0;
	const width = Math.min(own, (input.maxPercent / 100) * input.lineWidth, input.lineWidth);
	if (!(width > 0)) return null;
	return {
		side: input.side,
		layoutTop: 0,
		width,
		height: width * ratio,
		margin: input.gap,
		inset: input.lineInset,
		marginTop: 0,
		marginBottom: input.marginBottom,
	};
}

/** One block of CodeMirror's height map below a picture never drawn, for estimateTextHeight. */
export interface LineSample {
	/** The line's text, or null for a block of several lines (a table, a folded section). */
	text: string | null;
	/** Its height in the height map: CodeMirror's guess for a line it has not drawn. */
	mapHeight: number;
	/** A line of images wrapped left or right only: it takes no height. */
	floats: boolean;
}

export interface TextMetrics {
	/** Width of a line's content box in the note column, beside no picture. */
	lineWidth: number;
	/** Inset of a line's content box from the column's edge, on the picture's side. */
	lineInset: number;
	charWidth: number;
	lineHeight: number;
}

/** Markup Live Preview hides on lines without the cursor, and what a link shows instead of its target. */
const HIDDEN_MARKUP = /\*\*|__|~~|==|`/g;
const WIKILINK = /\[\[([^\]|]*)\|?([^\]]*)\]\]/g;
const MD_LINK = /\[([^\]]*)\]\([^)]*\)/g;

/** How many characters of `text` Live Preview shows, roughly: links by their text, emphasis marks left out. */
export function visibleLength(text: string): number {
	return text
		.replace(WIKILINK, (_m, target: string, alias: string) => alias || target)
		.replace(MD_LINK, '$1')
		.replace(HIDDEN_MARKUP, '').length;
}

/** A list item, quote or footnote line: the plain lines right after it continue it (scanLines). */
const CONTINUED = /^(?:[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)| {0,3}>|\[\^[^\]]+\]:)/;

/** `text` without the parts `from`..`to` (offsets within it): a line without its wrapped pictures. */
export function withoutRanges(text: string, ranges: readonly { from: number; to: number }[]): string {
	let out = '';
	let at = 0;
	for (const { from, to } of [...ranges].sort((a, b) => a.from - b.from)) {
		out += text.slice(at, Math.max(at, from));
		at = Math.max(at, to);
	}
	return out + text.slice(at);
}

/**
 * Where a picture inside a sentence, never drawn, starts below the top of its line: a float starts on
 * the row of text its link is on, and the text before it (`before`) fills whole rows of the line.
 */
export function rowsBefore(before: string, metrics: TextMetrics): number {
	const rows = Math.floor((visibleLength(before) * metrics.charWidth) / Math.max(metrics.charWidth, metrics.lineWidth));
	return rows * metrics.lineHeight;
}

/**
 * How tall the blocks below a picture's own line (which takes no height) are drawn, beside the
 * picture `box` while it reaches them and at full width after it. For a picture CodeMirror has never
 * drawn: its height map guesses those lines at full width and the image line at an embed's height,
 * so a stand-in placed from it sits too low and moves when the picture is drawn (measured: 164px on
 * a 788px picture). Plain paragraph lines are counted in rows of `charWidth` characters; anything else
 * (headings, lists, tables, code, lines with links in pipes or images) keeps its height-map height.
 * For a picture inside a sentence, the blocks start with its own line (its text, without the
 * picture), whose rows above the picture (`narrowFrom`) run at full width.
 * Stops once past `limit`, where the picture cannot reach any more.
 */
export function estimateTextHeight(blocks: Iterable<LineSample>, box: FloatBox, metrics: TextMetrics, limit = Infinity, narrowFrom = 0): number {
	const reach = box.layoutTop + box.height + box.marginBottom;
	const intrusion = Math.max(0, box.inset + box.width + box.margin - metrics.lineInset);
	const narrow = Math.max(metrics.charWidth, metrics.lineWidth - intrusion);
	const full = Math.max(metrics.charWidth, metrics.lineWidth);
	let y = 0;
	// After a fence (code, math, a comment) nothing is modelled any more; after a list item, quote or
	// footnote, the plain lines up to the next blank line belong to it.
	let modelled = true;
	let continued = false;
	for (const block of blocks) {
		if (y > limit) break;
		const text = block.text;
		if (block.floats) continue;
		if (text === null || !modelled) {
			y += block.mapHeight;
			continue;
		}
		if (opensOrCloses(text, false)) {
			modelled = false;
			y += block.mapHeight;
			continue;
		}
		if (text.trim() === '') {
			continued = false;
			y += metrics.lineHeight;
			continue;
		}
		if (CONTINUED.test(text)) continued = true;
		if (continued || text.includes('![') || !isPlainLine(text)) {
			y += block.mapHeight;
			continue;
		}
		let rest = visibleLength(text) * metrics.charWidth;
		do {
			rest -= y >= narrowFrom && y < reach ? narrow : full;
			y += metrics.lineHeight;
		} while (rest > 0);
	}
	return y;
}

/** Two boxes the same to the half pixel: re-planning on smaller changes would only churn. */
export function sameBox(a: FloatBox | undefined, b: FloatBox | undefined): boolean {
	if (!a || !b) return a === b;
	const near = (x: number, y: number) => Math.abs(x - y) < 0.5;
	return (
		a.side === b.side &&
		near(a.layoutTop, b.layoutTop) &&
		near(a.width, b.width) &&
		near(a.height, b.height) &&
		near(a.margin, b.margin) &&
		near(a.inset, b.inset) &&
		near(a.marginTop, b.marginTop) &&
		near(a.marginBottom, b.marginBottom) &&
		a.refPos === b.refPos &&
		(a.refOffset === undefined) === (b.refOffset === undefined) &&
		(a.refOffset === undefined || near(a.refOffset, b.refOffset!))
	);
}
