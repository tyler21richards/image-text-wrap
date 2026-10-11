// Numbers for drag to move. Pure, no Obsidian or DOM imports, so it is unit tested.
//
// The edge auto-scroll ramp (48 px band, up to 24 px a frame) is adapted from Adjustable Media
// (src/view/blockDrag.ts, edgeSpeed), MIT, (c) 2026 Yi-luo-hua.

/** A press becomes a drag once the pointer has moved more than this many pixels. */
export const DRAG_THRESHOLD = 5;
/** Band inside the scroller's top and bottom edge where a drag scrolls the note. */
export const SCROLL_EDGE = 48;
/** Fastest auto-scroll, in pixels per animation frame. */
export const SCROLL_SPEED = 24;

/** Touch and pen: a finger that rests this long on an image picks it up, in milliseconds. */
export const LONG_PRESS_MS = 500;
/**
 * Touch and pen: how far a resting finger may wander, in pixels. Further before the image is picked up, and the
 * press is a swipe that scrolls the note; further after it, and the image is dragged.
 */
export const LONG_PRESS_SLOP = 8;
/** Touch and pen: the gap between the finger and the copy of the image drawn above it. */
export const FINGER_GAP = 32;

export type Side = 'left' | 'right';

export function pastThreshold(dx: number, dy: number): boolean {
	return Math.hypot(dx, dy) > DRAG_THRESHOLD;
}

export function pastSlop(dx: number, dy: number): boolean {
	return Math.hypot(dx, dy) > LONG_PRESS_SLOP;
}

/**
 * Where a ghost of `width` x `height` goes for a finger at (x, y), so the finger does not hide it: centred
 * above the finger, or below it when there is no room above. It stays inside the window (`screen`).
 */
export function ghostByFinger(
	x: number,
	y: number,
	width: number,
	height: number,
	screen: { width: number; height: number },
	gap = FINGER_GAP,
): { left: number; top: number } {
	const left = clamp(x - width / 2, 0, screen.width - width);
	const above = y - gap - height;
	const top = above >= 0 ? above : clamp(y + gap, 0, screen.height - height);
	return { left, top };
}

export interface Band {
	top: number;
	bottom: number;
}

/** A box on screen, as getBoundingClientRect gives it. */
export interface Box extends Band {
	left: number;
	right: number;
}

/**
 * The part of a scroller that can be seen, top to bottom: inside the `viewport` (what the on-screen keyboard and
 * the system bars leave), and clear of the bars drawn over the scroller (`covers`). A cover over the upper half of
 * the scroller ends the band at its bottom, one over the lower half at its top; covers that miss the scroller are
 * ignored. When nothing would be left, the whole scroller.
 */
export function visibleBand(scroller: Box, viewport: Band, covers: readonly Box[]): Band {
	let top = Math.max(scroller.top, viewport.top);
	let bottom = Math.min(scroller.bottom, viewport.bottom);
	const middle = (scroller.top + scroller.bottom) / 2;
	for (const c of covers) {
		if (c.bottom <= c.top || c.right <= c.left) continue;
		if (c.bottom <= scroller.top || c.top >= scroller.bottom || c.right <= scroller.left || c.left >= scroller.right) continue;
		if ((c.top + c.bottom) / 2 < middle) top = Math.max(top, c.bottom);
		else bottom = Math.min(bottom, c.top);
	}
	return bottom > top ? { top, bottom } : { top: scroller.top, bottom: scroller.bottom };
}

/** The half of the note column the pointer is in. */
export function sideAt(x: number, left: number, right: number): Side {
	return x < (left + right) / 2 ? 'left' : 'right';
}

/**
 * Pixels to scroll this frame: negative near the top edge, positive near the bottom, faster the deeper
 * the pointer is in the band, and full speed beyond the edge.
 */
export function scrollSpeed(y: number, top: number, bottom: number): number {
	const above = top + SCROLL_EDGE - y;
	const below = y - (bottom - SCROLL_EDGE);
	if (above > 0) return -Math.min(SCROLL_SPEED, (above / SCROLL_EDGE) * SCROLL_SPEED);
	if (below > 0) return Math.min(SCROLL_SPEED, (below / SCROLL_EDGE) * SCROLL_SPEED);
	return 0;
}

/**
 * Index of the target whose top is nearest to `y`, or -1 when there is none. `topAt(i)` must not
 * decrease with `i` (line tops in document order). Ties go to the earlier target, and targets that
 * share a top (lines hidden in a fold) count as the first of them.
 *
 * When `lastIsEnd` is set, the last target is the end of the note (its top is the note's bottom), and a
 * `y` below it always picks it: the note's last line can take no height (a line holding only a wrapped
 * image), and the end would otherwise lose every tie with it.
 */
export function nearestTarget(count: number, topAt: (i: number) => number, y: number, lastIsEnd = false): number {
	if (count <= 0) return -1;
	if (lastIsEnd && y > topAt(count - 1)) return count - 1;
	let lo = 0;
	let hi = count - 1;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (topAt(mid) < y) lo = mid + 1;
		else hi = mid;
	}
	let best = lo;
	if (lo > 0 && Math.abs(topAt(lo - 1) - y) <= Math.abs(topAt(lo) - y)) best = lo - 1;
	while (best > 0 && topAt(best - 1) === topAt(best)) best--;
	return best;
}

/** How far the part of the note that starts at document position `pos` moves (by < 0: up). */
export interface Shift {
	pos: number;
	by: number;
}

/**
 * How far the note moves at `pos`: as far as the last part that starts at or before it (`shifts` in document
 * order), or not at all above the first part.
 */
export function shiftAt(shifts: readonly Shift[], pos: number): number {
	let lo = 0;
	let hi = shifts.length;
	while (lo < hi) {
		const mid = (lo + hi) >> 1;
		if (shifts[mid]!.pos <= pos) lo = mid + 1;
		else hi = mid;
	}
	return lo > 0 ? shifts[lo - 1]!.by : 0;
}

/**
 * How far the line a moved image lands on (original line `line`) rises once the move is written: the original
 * lines [removed.from, removed.to) go where they are above it, and everything above it re-flows. `top(i)` is
 * the top of original line `i` now, `flowedTop(i)` with the image gone from its old place.
 */
export function landingRise(
	line: number,
	removed: { from: number; to: number },
	top: (line: number) => number,
	flowedTop: (line: number) => number,
): number {
	let rise = top(line) - flowedTop(line);
	const end = Math.min(removed.to, line);
	if (removed.from < end) rise += flowedTop(end) - flowedTop(removed.from);
	return rise;
}

/**
 * How far a dropped image would land above the drop indicator: the view is held so the landing stays put,
 * by scrolling up as far as the landing `rise`s, but a note cannot scroll above its top.
 */
export function landingShortfall(rise: number, scrollTop: number): number {
	return Math.max(0, rise - Math.max(0, scrollTop));
}

/** Scales a width and height down (never up) to fit a box, keeping the proportions. */
export function fitWithin(width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
	if (width <= 0 || height <= 0) return { width: Math.max(0, Math.min(width, maxWidth)), height: Math.max(0, Math.min(height, maxHeight)) };
	const scale = Math.min(1, maxWidth / width, maxHeight / height);
	return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), Math.max(min, max));
}
