// Where the picture toolbar goes, from measured rectangles. Pure geometry, no DOM or Obsidian imports.

export interface Box {
	left: number;
	top: number;
	right: number;
	bottom: number;
}

export interface PlaceInput {
	/** The picture. */
	image: Box;
	/** The part of the editor's scroller that is on screen. */
	visible: Box;
	/** The note column; the toolbar stays between its left and right edges. */
	column: Box;
	/** The toolbar's size. */
	width: number;
	height: number;
	/** Obsidian's own controls on the image (zoom, edit, resize corner). The toolbar never covers them. */
	avoid: readonly Box[];
	/** Space between the picture and the toolbar. */
	gap: number;
	/** Space kept from the edges of the visible scroller. */
	margin: number;
}

export type PlaceWhere = 'above' | 'below' | 'inside';

export interface Placement {
	left: number;
	top: number;
	where: PlaceWhere;
}

/**
 * Whether the toolbar stays where it was. Placements are whole pixels, so a re-measure that finds the
 * picture where it was gives the same spot, and anything open under the toolbar can stay put.
 */
export function samePlace(a: Placement, b: Placement): boolean {
	return a.left === b.left && a.top === b.top;
}

function overlaps(a: Box, b: Box): boolean {
	return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(value, max));
}

/** The visible part of the picture, or null when none of it is on screen. */
export function visiblePart(image: Box, visible: Box): Box | null {
	const part = {
		left: Math.max(image.left, visible.left),
		top: Math.max(image.top, visible.top),
		right: Math.min(image.right, visible.right),
		bottom: Math.min(image.bottom, visible.bottom),
	};
	return part.right > part.left && part.bottom > part.top ? part : null;
}

/**
 * Just above the picture; else just below it; else, for a picture taller than the visible area, inside
 * its visible part at the top left. The native controls sit at the picture's top right (zoom, edit) and
 * bottom right (resize corner), so a toolbar above or below the picture cannot cover them, and inside the
 * picture it starts at the left and moves down past any control it would touch.
 * Returns null when the picture is scrolled out of view, so the toolbar hides.
 */
export function placeToolbar(p: PlaceInput): Placement | null {
	const shown = visiblePart(p.image, p.visible);
	if (!shown) return null;

	// Horizontally: start at the picture's left edge, inside the note column and the visible scroller.
	const minLeft = Math.max(p.column.left, p.visible.left + p.margin);
	const maxLeft = Math.min(p.column.right, p.visible.right - p.margin) - p.width;
	const left = Math.round(maxLeft < minLeft ? minLeft : clamp(p.image.left, minLeft, maxLeft));

	const topLimit = p.visible.top + p.margin;
	const bottomLimit = p.visible.bottom - p.margin;
	const box = (top: number, l = left): Box => ({ left: l, top, right: l + p.width, bottom: top + p.height });
	const clear = (b: Box) => b.top >= topLimit && b.bottom <= bottomLimit && !p.avoid.some((a) => overlaps(a, b));

	const above = p.image.top - p.gap - p.height;
	if (clear(box(above))) return { left, top: Math.round(above), where: 'above' };
	const below = p.image.bottom + p.gap;
	if (clear(box(below))) return { left, top: Math.round(below), where: 'below' };

	// Inside the visible part of a tall picture, from its top-left corner downwards.
	const insideLeft = Math.round(
		maxLeft < minLeft ? minLeft : clamp(shown.left + p.gap, minLeft, Math.max(minLeft, maxLeft)),
	);
	const start = Math.max(shown.top, topLimit) + p.gap;
	const candidates = [start, ...p.avoid.map((a) => a.bottom + p.gap)].filter((t) => t >= start).sort((a, b) => a - b);
	for (const top of candidates) {
		if (clear(box(top, insideLeft))) return { left: insideLeft, top: Math.round(top), where: 'inside' };
	}
	// Nothing is free (a tiny window): stay at the top of the visible area rather than vanish.
	return { left: insideLeft, top: Math.round(Math.min(start, bottomLimit - p.height)), where: 'inside' };
}

// ---------- The sheet on phones and tablets ----------

/** What sits at the bottom of a phone or tablet screen, measured in window coordinates. */
export interface SheetScreen {
	/** The window's height (innerHeight), which a fixed element's `bottom` counts from. */
	height: number;
	/**
	 * The visual viewport's top and height, when the page is not zoomed. A keyboard that shrinks the visual
	 * viewport rather than the window ends it.
	 */
	visual: { top: number; height: number } | null;
	/** How much of the bottom of the window the keyboard covers, as Obsidian reports it (--keyboard-height). */
	keyboard: number;
	/** The bottom safe-area inset (the home indicator). */
	safeBottom: number;
	/** The top safe-area inset (the status bar, a notch). */
	safeTop: number;
	/** The tops of the bars docked at the bottom: Obsidian's navigation bar and its editing toolbar. */
	bars: readonly number[];
	/** Space kept between the sheet and whatever is below it. */
	gap: number;
}

/** The note's header bar, which lies over the top of the note on phones, in window coordinates. */
export interface SheetHeader {
	/** Its bottom edge now; -Infinity when there is none. */
	bottom: number;
	/** Its bottom edge where it rests while shown, leaving out a slide away (a transform) under way or done. */
	restingBottom: number;
	/**
	 * Whether it slides away as soon as the note scrolls down: Obsidian's "auto full screen" on phones, which
	 * does not act while the keyboard is up.
	 */
	hidesOnScroll: boolean;
}

/** Whether a keyboard covers the bottom of the screen, as Obsidian reports it or as the visual viewport shows it. */
export function keyboardShown(s: SheetScreen): boolean {
	return s.keyboard > 0 || (!!s.visual && s.visual.top + s.visual.height < s.height - 1);
}

/**
 * How far above the bottom of the window the sheet's bottom edge goes: clear of the keyboard, the bars and
 * the safe area, whichever reaches highest.
 */
export function sheetBottom(s: SheetScreen): number {
	let floor = s.height - s.keyboard;
	if (s.visual) floor = Math.min(floor, s.visual.top + s.visual.height);
	for (const top of s.bars) floor = Math.min(floor, top);
	return Math.round(Math.max(s.height - floor, s.safeBottom) + s.gap);
}

/**
 * Where the top edge of a sheet `height` px tall goes (window px), sitting at sheetBottom(s). Null when it
 * does not fit: it must stay on screen, below the note's header (where it rests while shown, so the sheet
 * does not come and go as the header slides) and the top safe area, and leave at least `noteRoom` px of the
 * note visible between them.
 */
export function sheetTop(s: SheetScreen, height: number, header: SheetHeader, noteRoom: number): number | null {
	const top = s.height - sheetBottom(s) - height;
	const limit = Math.max(0, s.safeTop, header.restingBottom);
	return top - limit >= noteRoom ? top : null;
}

/** A window at most this tall (a phone in landscape) always gets the compact sheet. */
export const SHORT_WINDOW = 500;

/** How much of the note each form of the sheet leaves in view at least (sheetTop's `noteRoom`). */
export interface SheetRoom {
	full: number;
	compact: number;
}

/** The form of the sheet that shows (compact: one row instead of two), and where its top edge goes. */
export interface SheetForm {
	compact: boolean;
	top: number;
}

/**
 * Which form of the sheet shows, and where (sheetTop): the full sheet when it leaves `room.full` px of the note
 * in view, else the compact one when that leaves `room.compact` px, else none (null: with the keyboard up on a
 * phone in landscape there may be no such room, and the sheet waits until there is). A short window
 * (SHORT_WINDOW) always gets the compact sheet, which leaves room above it for the picture it is for.
 * `heightOf` measures the sheet in a form; the compact one is measured only when it is needed.
 */
export function sheetForm(s: SheetScreen, header: SheetHeader, room: SheetRoom, heightOf: (compact: boolean) => number): SheetForm | null {
	if (s.height > SHORT_WINDOW) {
		const top = sheetTop(s, heightOf(false), header, room.full);
		if (top !== null) return { compact: false, top };
	}
	const top = sheetTop(s, heightOf(true), header, room.compact);
	return top === null ? null : { compact: true, top };
}

/**
 * How high a reveal (revealScroll) may bring a picture's top: below the note's header and the top safe area.
 * A header that slides away as the note scrolls down does not count: the reveal's own scroll sends it away.
 */
export function revealTop(s: SheetScreen, header: SheetHeader, scrollerTop: number): number {
	return Math.max(0, scrollerTop, s.safeTop, header.hidesOnScroll ? -Infinity : header.bottom);
}

/**
 * How far to scroll the note (positive: the text moves up) so the sheet does not cover the picture: until
 * the picture's bottom is `margin` px above the sheet, but never so far that its top goes above the visible
 * area (a tall picture shows its top). 0 when the sheet does not cover it.
 */
export function revealScroll(picture: Box, visibleTop: number, sheetTop: number, margin: number): number {
	if (picture.bottom <= sheetTop) return 0;
	const clear = picture.bottom - (sheetTop - margin);
	const most = picture.top - (visibleTop + margin);
	return Math.max(0, Math.round(Math.min(clear, most)));
}
