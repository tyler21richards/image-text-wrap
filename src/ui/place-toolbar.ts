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
