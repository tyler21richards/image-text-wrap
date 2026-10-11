// Geometry of Reading view stand-ins (see stand-ins.ts). Pure, no Obsidian imports.
//
// A wrapped image floats out of its own section into the sections below it. Each of those sections
// ("hosts") can carry a hidden copy of the part of the float that lies below the host's top, so the
// text keeps its wrap when Obsidian takes the image's own section off the page.
//
// Adapted from Adjustable Media (src/layout/wrapGaps.ts planProxy, src/view/readingWrap.ts), MIT,
// (c) 2026 Yi-luo-hua.

export type Side = 'left' | 'right';

/** A floating image, in page coordinates (px). `top`/`bottom` are its margin box, `imgTop` the picture's top. */
export interface FloatBox {
	side: Side;
	top: number;
	bottom: number;
	imgTop: number;
	/** The picture's own height. */
	imgHeight: number;
	width: number;
	gap: number;
	/** From the edge of the note column on its side to its border box. */
	inset: number;
}

/** A section after the image's own section, in page coordinates. `skip`: it cannot hold a float (it is a formatting context of its own). */
export interface HostBox {
	top: number;
	skip: boolean;
}

export interface StandIn {
	/** Index into the floats given to planStandIns, which are in document order. */
	float: number;
	/** Index into that float's hosts. */
	host: number;
	side: Side;
	/** Space above the stand-in inside its host (after any earlier stand-in on the same side). */
	marginTop: number;
	height: number;
	/** How much of the picture lies above the stand-in: its copy is shifted up by this much. */
	offset: number;
	width: number;
	gap: number;
	/** Height of the whole picture its copy shows. */
	pictureHeight: number;
}

/** The hosts a float reaches: those whose top is above the float's bottom. `hosts` are in page order. */
export function reachedHosts(float: FloatBox, hosts: readonly HostBox[]): number[] {
	const out: number[] = [];
	for (let i = 0; i < hosts.length; i++) {
		if (hosts[i]!.top >= float.bottom - 0.5) break;
		out.push(i);
	}
	return out;
}

/**
 * Plans the stand-ins one host carries, for the floats (in document order) that reach it.
 * `hostTop` is the host's top. Same-side stand-ins stack (they clear each other, as the images do),
 * so each one's margin is measured from the bottom of the one before it on its side; `start` gives the
 * bottoms of stand-ins already in the host for earlier images (page coordinates).
 */
export function planHost(
	hostTop: number,
	floats: readonly { index: number; box: FloatBox }[],
	start: Partial<Record<Side, number>> = {},
	hostIndex = 0,
): StandIn[] {
	const below: Record<Side, number> = {
		left: Math.max(hostTop, start.left ?? hostTop),
		right: Math.max(hostTop, start.right ?? hostTop),
	};
	const out: StandIn[] = [];
	for (const { index, box } of floats) {
		const visibleTop = Math.max(box.top, hostTop);
		const height = box.bottom - visibleTop;
		if (height <= 0.5) continue;
		const marginTop = Math.max(0, visibleTop - below[box.side]);
		out.push({
			float: index,
			host: hostIndex,
			side: box.side,
			marginTop: round(marginTop),
			height: round(height),
			offset: round(Math.max(0, visibleTop - box.imgTop)),
			width: round(box.width),
			gap: round(box.gap),
			pictureHeight: round(box.imgHeight),
		});
		below[box.side] = Math.max(below[box.side], box.bottom);
	}
	return out;
}

/** A float moved up by `delta` against the sections after it (down when negative). */
export function moveFloat(box: FloatBox, delta: number): FloatBox {
	return { ...box, top: box.top - delta, bottom: box.bottom - delta, imgTop: box.imgTop - delta };
}

/** A float in coordinates that start at `origin` (a host's top). */
export function floatFrom(box: FloatBox, origin: number): FloatBox {
	return moveFloat(box, origin);
}

/** What a link edit can change of a floating image where it stands. */
export interface Reshape {
	side: Side;
	width: number;
	gap: number;
}

/**
 * The float of an image whose link was edited (another side, size or spacing): its top stays where it
 * is, and the picture keeps its aspect ratio, so its bottom moves by as much as the picture's height.
 */
export function reshapeFloat(box: FloatBox, shape: Reshape): FloatBox {
	const imgHeight = box.width > 0 ? (box.imgHeight * shape.width) / box.width : box.imgHeight;
	return { ...box, side: shape.side, width: shape.width, gap: shape.gap, imgHeight, bottom: box.bottom + imgHeight - box.imgHeight };
}

/**
 * The width a floating image is drawn at: its own (`own`, from its link or the picture), at most `cap`
 * (the widest wrapped picture). Measured at `measured` when its own width was `ownBefore`: drawn
 * narrower than its own width then, it was held at the cap, which is therefore known exactly.
 */
export function drawnWidth(own: number, ownBefore: number, measured: number, cap: number): number {
	const held = measured < ownBefore - 0.5 ? measured : cap;
	return round(Math.min(own, held));
}

/**
 * How far floats push in the sides of a section that keeps floats to itself (a table, which Obsidian
 * lets scroll sideways): beside a float it is narrowed as a whole, to the float's margin box. `floats`
 * are in the section's coordinates (its top at 0); those that end above it do not count.
 */
export function narrowing(floats: Iterable<FloatBox>): Record<Side, number> {
	const out: Record<Side, number> = { left: 0, right: 0 };
	for (const box of floats) {
		if (box.bottom <= 0.5) continue;
		out[box.side] = Math.max(out[box.side], round(box.inset + box.width + box.gap));
	}
	return out;
}

function round(n: number): number {
	return Math.round(n * 100) / 100;
}
