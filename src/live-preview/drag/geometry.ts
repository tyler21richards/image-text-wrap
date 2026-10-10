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

export type Side = 'left' | 'right';

export function pastThreshold(dx: number, dy: number): boolean {
	return Math.hypot(dx, dy) > DRAG_THRESHOLD;
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

/** Scales a width and height down (never up) to fit a box, keeping the proportions. */
export function fitWithin(width: number, height: number, maxWidth: number, maxHeight: number): { width: number; height: number } {
	if (width <= 0 || height <= 0) return { width: Math.max(0, Math.min(width, maxWidth)), height: Math.max(0, Math.min(height, maxHeight)) };
	const scale = Math.min(1, maxWidth / width, maxHeight / height);
	return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export function clamp(value: number, min: number, max: number): number {
	return Math.min(Math.max(value, min), Math.max(min, max));
}
