// Plans stand-ins for wrapped images whose own line CodeMirror is not drawing (brief 7 item 6).
// Pure: works on numbers measured elsewhere, no DOM and no Obsidian imports, so it is unit tested.
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

import { findImageLinks, isSizeSegment, type ImageLink } from '../grammar';
import { scanLines } from '../markdown/lines';

export type FloatSide = 'left' | 'right';

/** A line that holds nothing but one image wrapped left or right: its picture floats out of it. */
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
}

/**
 * Wrapped image lines in body text. Lines in code, math, comments, frontmatter, lists, quotes,
 * tables and headings are left out: there the picture either does not float or stays inside its line.
 */
export function findFloatAnchors(lines: readonly string[]): FloatAnchor[] {
	const out: FloatAnchor[] = [];
	let infos: ReturnType<typeof scanLines> | null = null;
	lines.forEach((text, line) => {
		if (!text.includes('wrap-left') && !text.includes('wrap-right')) return;
		const links = findImageLinks(text);
		if (links.length !== 1) return;
		const link = links[0]!;
		if (text.slice(0, link.from).trim() || text.slice(link.to).trim()) return;
		const wrap = link.layout.wrap;
		if (wrap !== 'left' && wrap !== 'right') return;
		infos ??= scanLines(lines);
		const info = infos[line];
		if (!info || info.context !== 'text' || info.kind !== 'paragraph') return;
		out.push({
			line,
			linkFrom: link.from,
			linkTo: link.to,
			raw: text.slice(link.from, link.to),
			side: wrap,
			gap: link.layout.gap,
			link,
		});
	});
	return out;
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
