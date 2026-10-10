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
	width: number;
	gap: number;
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
		});
		below[box.side] = Math.max(below[box.side], box.bottom);
	}
	return out;
}

function round(n: number): number {
	return Math.round(n * 100) / 100;
}
