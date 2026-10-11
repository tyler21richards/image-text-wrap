// Keeps text wrapped beside a floating image while Obsidian has taken the image's own section off the
// page (brief 7 item 9).
//
// Reading view only keeps the sections near the screen in the page. A wrapped image floats out of its
// own section into the sections below it; when Obsidian removes the image's section (scrolling down past
// a tall image) while those are still in the page, their text loses its wrap, they get shorter, and
// everything below jumps (120 px measured on test-vault/Fixture.md; none with the plugin off).
//
// Each section an image reaches gets a hidden stand-in: an empty float the size of the part of the image
// below that section's top, showing a clipped copy of the picture. styles.css shows the stand-ins of the
// first section in the page only (the one right after Obsidian's pusher element), which is exactly when
// the sections above it, the image's among them, are gone. The swap happens in the same layout pass as
// Obsidian's removal, so nothing moves. Stand-ins are planned from the page while the image's section is
// in it; a note opened at its end and scrolled up can still jump once, the first time.
//
// A section that keeps floats to itself (a table, which Obsidian lets scroll sideways) cannot hold a
// stand-in: beside a float it is narrowed as a whole. It is marked instead, with how far the floats
// beside it narrow it, and styles.css narrows it that much while it is first in the page; the next host
// then shows its stand-ins (measured on a table beside a 675px picture: jumps of 278px and 96px without).
//
// The copy is drawn as a background, not as an img: Obsidian's image viewer pages through every img of
// the note's sections, and showed the copies as extra pictures.
//
// Adapted from Adjustable Media (src/view/readingWrap.ts and styles.css .vml-rv-proxy), MIT,
// (c) 2026 Yi-luo-hua. It needs Obsidian's list of sections (sections.ts); without it nothing is done.
import type { MarkdownView } from 'obsidian';
import { READING_IMAGES } from '../dom';
import { allSectionEls, sectionHeights, sizerOf } from './sections';
import {
	drawnWidth,
	floatFrom,
	moveFloat,
	narrowing,
	planHost,
	reachedHosts,
	reshapeFloat,
	type FloatBox,
	type Side,
	type StandIn,
} from './stand-in-plan';
import { layoutFromAlt, wrapFromAlt } from './wraps';

export const HOST_CLASS = 'itw-host';
export const SKIP_HOST_CLASS = 'itw-host-skip';
export const STAND_IN_CLASS = 'itw-rv-stand-in';
const PICTURE_CLASS = `${STAND_IN_CLASS}-picture`;
const SKIP_VARS = ['--itw-skip-left', '--itw-skip-right'];
/** Frames to keep planning after a section was rendered off the page (Keeper.settle). */
const SETTLE_FRAMES = 10;

/** The picture each stand-in shows. */
const shownSrc = new WeakMap<HTMLElement, string>();

/** Where a planned float stands in the note and what it shows, to find it again after Obsidian renders its section anew. */
interface FloatInfo {
	/** Its section's place among the note's sections, and its own among that section's floats. */
	index: number;
	n: number;
	/** The picture's address. */
	src: string;
	/** Its own width when measured: from its link, else the picture's. */
	own: number;
	/** The widest a wrapped picture was drawn there (styles.css: a share of the line). */
	cap: number;
}

/** How a float changed while its section was off the page: moved against what follows it, or edited. */
type Change = (box: FloatBox) => FloatBox;

interface Keeper {
	view: MarkdownView;
	sizer: HTMLElement;
	width: number;
	frame: number;
	/** Frames left to plan again by itself after following a section rendered off the page (findAgain). */
	settle: number;
	mutations: MutationObserver;
	resize: ResizeObserver;
	onLoad: () => void;
	/** Each host section, with its stand-ins keyed by the floating element they copy. */
	hosts: Map<HTMLElement, Map<HTMLElement, HTMLElement>>;
	/** Each section that keeps floats to itself, with the floats beside it (from its top). */
	skips: Map<HTMLElement, Map<HTMLElement, FloatBox>>;
	/** The section each planned float lives in. */
	floatSection: WeakMap<HTMLElement, HTMLElement>;
	/** The height Obsidian gave each planned float's section when the float was measured (sections.ts). */
	sectionHeight: WeakMap<HTMLElement, number>;
	/** Sections Obsidian rendered anew off the page that hold a planned float, with the height last seen (findAgain). */
	renderedOff: WeakMap<HTMLElement, number | undefined>;
	floatInfo: WeakMap<HTMLElement, FloatInfo>;
	/** Each stand-in's float as it was planned, from the top of the stand-in's host. */
	placed: WeakMap<HTMLElement, FloatBox>;
}

interface Measured {
	el: HTMLElement;
	img: HTMLImageElement;
	box: FloatBox;
	/** Position in the note, for ordering stand-ins inside a host. */
	order: number;
}

/** What one plan learns about floats whose section was rendered again off the page. */
interface Following {
	sections: readonly HTMLElement[];
	alive: ReadonlySet<HTMLElement>;
	heights: ReadonlyMap<HTMLElement, number>;
	/** Each float followed so far: where it is now (itself or the image that replaced it), or null when gone. */
	found: Map<HTMLElement, HTMLElement | null>;
	/** How the floats found again changed, by their element now. */
	changes: Map<HTMLElement, Change>;
	/** A float was followed into a section rendered off the page, or that section's height changed. */
	followedOff: boolean;
}

function sideOf(el: HTMLElement): Side | null {
	const float = el.win.getComputedStyle(el).float;
	return float === 'left' || float === 'right' ? float : null;
}

/** A section that is a formatting context of its own keeps floats inside it, so it cannot host one. */
function isOwnContext(el: HTMLElement): boolean {
	const cs = el.win.getComputedStyle(el);
	return cs.overflowX !== 'visible' || cs.overflowY !== 'visible' || /^(flow-root|flex|grid|table|inline-block)$/.test(cs.display);
}

/** Images of a section that float out of it: those in its own paragraphs (lists, quotes and callouts contain theirs). */
function floatsIn(section: HTMLElement): HTMLElement[] {
	return Array.from(section.querySelectorAll<HTMLElement>(READING_IMAGES)).filter((el) => {
		if (el.parentElement?.tagName !== 'P' || el.parentElement.parentElement !== section) return false;
		const wrap = wrapFromAlt(el.getAttribute('alt'));
		return wrap === 'left' || wrap === 'right';
	});
}

function pictureOf(el: HTMLElement): HTMLImageElement | null {
	return el.instanceOf(HTMLImageElement) ? el : el.querySelector('img');
}

/** An image's own width: the one in its link (Obsidian's width attribute), else the picture's. */
function ownWidth(el: HTMLElement, img: HTMLImageElement): number | null {
	const attr = parseFloat(el.getAttribute('width') ?? img.getAttribute('width') ?? '');
	if (attr > 0) return attr;
	return img.naturalWidth > 0 ? img.naturalWidth : null;
}

/** The widest `el` may be drawn, from its max-width (styles.css: a share of its paragraph). */
function widthCap(el: HTMLElement, cs: CSSStyleDeclaration): number {
	const max = cs.maxWidth;
	const room = el.parentElement?.clientWidth ?? Infinity;
	if (max.endsWith('%')) return (parseFloat(max) / 100) * room;
	const px = parseFloat(max);
	return Number.isFinite(px) ? Math.min(px, room) : room;
}

/** A URL as a CSS url() value. */
function cssUrl(src: string): string {
	return `url("${src.replace(/["\\\n\r]/g, (c) => (c === '\n' ? '\\a ' : c === '\r' ? '\\d ' : `\\${c}`))}")`;
}

/** Sizes and places one stand-in. `bottom` is where its float ends, from the host's top. */
function applyPlan(standIn: HTMLElement, plan: StandIn, bottom: number): void {
	standIn.toggleClass(`${STAND_IN_CLASS}-left`, plan.side === 'left');
	standIn.toggleClass(`${STAND_IN_CLASS}-right`, plan.side === 'right');
	// A later same-side stand-in stacks below it.
	standIn.dataset.bottom = String(Math.round(bottom * 100) / 100);
	standIn.setCssProps({
		'--itw-stand-in-width': `${plan.width}px`,
		'--itw-stand-in-height': `${plan.height}px`,
		'--itw-stand-in-top': `${plan.marginTop}px`,
		'--itw-stand-in-gap': `${plan.gap}px`,
		'--itw-stand-in-offset': `${plan.offset}px`,
		'--itw-stand-in-picture-height': `${plan.pictureHeight}px`,
	});
}

export class StandIns {
	private keepers = new Map<MarkdownView, Keeper>();

	/** Starts (or refreshes) stand-ins for a Reading view that shows a note with floating images. */
	watch(view: MarkdownView): void {
		const existing = this.keepers.get(view);
		if (existing) {
			this.schedule(existing);
			return;
		}
		const sizer = sizerOf(view);
		if (!sizer || !allSectionEls(view)) return;
		// The observers of the sizer's own window, which may be a pop-out.
		const win = sizer.win as Window & { MutationObserver: typeof MutationObserver; ResizeObserver: typeof ResizeObserver };
		const keeper: Keeper = {
			view,
			sizer,
			width: sizer.clientWidth,
			frame: 0,
			settle: 0,
			hosts: new Map(),
			skips: new Map(),
			floatSection: new WeakMap(),
			sectionHeight: new WeakMap(),
			renderedOff: new WeakMap(),
			floatInfo: new WeakMap(),
			placed: new WeakMap(),
			// Sections coming into or leaving the page, and sections re-rendered after an edit.
			mutations: new win.MutationObserver(() => this.schedule(keeper)),
			// Width changes re-flow everything.
			resize: new win.ResizeObserver(() => this.schedule(keeper)),
			onLoad: () => this.schedule(keeper),
		};
		keeper.mutations.observe(sizer, { childList: true });
		keeper.resize.observe(sizer);
		// Images change size when they load. `load` does not bubble, so listen in the capture phase.
		sizer.addEventListener('load', keeper.onLoad, true);
		this.keepers.set(view, keeper);
		this.schedule(keeper);
	}

	/** Removes every stand-in and class from a view and stops watching it. */
	unwatch(view: MarkdownView): void {
		const keeper = this.keepers.get(view);
		if (!keeper) return;
		keeper.sizer.win.cancelAnimationFrame(keeper.frame);
		keeper.mutations.disconnect();
		keeper.resize.disconnect();
		keeper.sizer.removeEventListener('load', keeper.onLoad, true);
		this.clearAll(keeper);
		this.keepers.delete(view);
	}

	/** Stops watching views that are closed. */
	prune(isOpen: (view: MarkdownView) => boolean): void {
		for (const view of [...this.keepers.keys()]) if (!isOpen(view)) this.unwatch(view);
	}

	destroy(): void {
		for (const view of [...this.keepers.keys()]) this.unwatch(view);
	}

	/** Forgets every stand-in and plans them again, from what is in the page (a setting changed their size). */
	refresh(): void {
		for (const keeper of this.keepers.values()) {
			this.clearAll(keeper);
			this.schedule(keeper);
		}
	}

	private schedule(keeper: Keeper): void {
		if (keeper.frame) return;
		keeper.frame = keeper.sizer.win.requestAnimationFrame(() => {
			keeper.frame = 0;
			try {
				this.plan(keeper);
			} catch (e) {
				// Never let a layout helper break Reading view; it only costs the fix.
				console.error('Image Text Wrap: could not plan Reading view stand-ins', e);
			}
		});
	}

	private clearAll(keeper: Keeper): void {
		for (const host of [...keeper.hosts.keys()]) this.clearHost(keeper, host);
		for (const host of [...keeper.skips.keys()]) this.clearSkip(keeper, host);
	}

	private clearHost(keeper: Keeper, host: HTMLElement): void {
		for (const standIn of keeper.hosts.get(host)?.values() ?? []) standIn.remove();
		host.removeClass(HOST_CLASS);
		keeper.hosts.delete(host);
	}

	private clearSkip(keeper: Keeper, host: HTMLElement): void {
		host.removeClass(SKIP_HOST_CLASS);
		for (const name of SKIP_VARS) host.style.removeProperty(name);
		keeper.skips.delete(host);
	}

	private plan(keeper: Keeper): void {
		const { sizer } = keeper;
		// A hidden pane measures nothing; it is planned again when it is shown (resize).
		if (!sizer.isConnected || sizer.clientWidth === 0) return;
		const sections = allSectionEls(keeper.view);
		if (!sections) return;
		const alive = new Set(sections);
		const order = new Map(sections.map((el, i) => [el, i]));

		// Forget stand-ins of sections that left the note, of images no longer in it, and, after a width
		// change, those that cannot be measured again now. Follow images whose section was re-rendered.
		const widthChanged = sizer.clientWidth !== keeper.width;
		keeper.width = sizer.clientWidth;
		const following: Following = { sections, alive, heights: sectionHeights(keeper.view), found: new Map(), changes: new Map(), followedOff: false };
		for (const [host, byFloat] of [...keeper.hosts]) {
			if (!alive.has(host) || (widthChanged && !host.isConnected)) {
				this.clearHost(keeper, host);
				continue;
			}
			// Rebuilt in the same order: a float that was replaced keeps its place.
			const next = new Map<HTMLElement, HTMLElement>();
			for (const [floatEl, standIn] of byFloat) {
				const now = this.follow(keeper, floatEl, following);
				if (now) next.set(now, standIn);
				else standIn.remove();
			}
			keeper.hosts.set(host, next);
		}
		for (const [host, floats] of [...keeper.skips]) {
			if (!alive.has(host) || (widthChanged && !host.isConnected)) {
				this.clearSkip(keeper, host);
				continue;
			}
			const next = new Map<HTMLElement, FloatBox>();
			for (const [floatEl, box] of floats) {
				const now = this.follow(keeper, floatEl, following);
				if (now) next.set(now, following.changes.get(now)?.(box) ?? box);
			}
			if (next.size === 0) {
				this.clearSkip(keeper, host);
				continue;
			}
			keeper.skips.set(host, next);
			if (following.changes.size > 0) this.narrow(host, next);
		}
		// Obsidian settles the height of a section it rendered off the page over the next frames, without
		// changing the page: plan again for a few frames to follow it.
		if (following.followedOff) keeper.settle = SETTLE_FRAMES;
		else if (keeper.settle > 0) keeper.settle--;
		if (keeper.settle > 0) this.schedule(keeper);
		if (following.changes.size > 0) {
			for (const [host, byFloat] of keeper.hosts) {
				if ([...byFloat.keys()].some((el) => following.changes.has(el))) this.replan(keeper, host, byFloat, following.changes);
			}
		}

		// Read: every floating image whose section is in the page, and the sections it reaches.
		const attached = (Array.from(sizer.children) as HTMLElement[]).filter((el) => alive.has(el));
		const tops = new Map<HTMLElement, number>();
		const topOf = (el: HTMLElement) => {
			let t = tops.get(el);
			if (t === undefined) tops.set(el, (t = el.getBoundingClientRect().top));
			return t;
		};
		const sizerRect = sizer.getBoundingClientRect();
		const sizerStyle = sizer.win.getComputedStyle(sizer);
		const colLeft = sizerRect.left + (parseFloat(sizerStyle.borderLeftWidth) || 0) + (parseFloat(sizerStyle.paddingLeft) || 0);
		const colRight = sizerRect.right - (parseFloat(sizerStyle.borderRightWidth) || 0) - (parseFloat(sizerStyle.paddingRight) || 0);
		const skip = new Map<HTMLElement, boolean>();
		const want = new Map<HTMLElement, Measured[]>();
		const measured = new Set<HTMLElement>();
		attached.forEach((section, i) => {
			// In the page: its floats are measured from now on, not followed.
			keeper.renderedOff.delete(section);
			floatsIn(section).forEach((el, n) => {
				const side = sideOf(el);
				const img = pictureOf(el);
				if (!side || !img) return;
				const rect = el.getBoundingClientRect();
				if (rect.height < 1) return; // not loaded yet: planned on its load event
				const cs = el.win.getComputedStyle(el);
				const imgRect = img.getBoundingClientRect();
				const box: FloatBox = {
					side,
					top: rect.top - parseFloat(cs.marginTop),
					bottom: rect.bottom + parseFloat(cs.marginBottom),
					imgTop: imgRect.top,
					imgHeight: imgRect.height,
					width: rect.width,
					gap: parseFloat(side === 'left' ? cs.marginRight : cs.marginLeft),
					inset: side === 'left' ? rect.left - colLeft : colRight - rect.right,
				};
				measured.add(el);
				keeper.floatSection.set(el, section);
				const height = following.heights.get(section);
				if (height !== undefined) keeper.sectionHeight.set(el, height);
				keeper.floatInfo.set(el, { index: order.get(section) ?? -1, n, src: img.src, own: ownWidth(el, img) ?? rect.width, cap: widthCap(el, cs) });
				const after = attached.slice(i + 1);
				const reached = reachedHosts(
					box,
					after.map((h) => ({ top: topOf(h), skip: false })),
				);
				for (const k of reached) {
					const host = after[k]!;
					if (!skip.has(host)) skip.set(host, isOwnContext(host));
					const list = want.get(host) ?? [];
					list.push({ el, img, box, order: (order.get(section) ?? 0) * 1000 + n });
					want.set(host, list);
				}
			});
		});

		// Write: stand-ins for the hosts in the page. Hidden ones do not change the layout.
		for (const host of attached) {
			const byFloat = keeper.hosts.get(host) ?? new Map<HTMLElement, HTMLElement>();
			for (const [floatEl, standIn] of byFloat) {
				if (measured.has(floatEl) && !want.get(host)?.some((m) => m.el === floatEl)) {
					standIn.remove();
					byFloat.delete(floatEl);
				}
			}
			const wanted = want.get(host) ?? [];
			// Known from a float measured now, else from before (its float may be off the page now).
			if (skip.get(host) ?? keeper.skips.has(host)) {
				if (keeper.hosts.has(host)) this.clearHost(keeper, host);
				this.skipHost(keeper, host, topOf(host), wanted, measured);
				continue;
			}
			if (keeper.skips.has(host)) this.clearSkip(keeper, host);
			if (wanted.length === 0 && byFloat.size === 0) {
				if (keeper.hosts.has(host)) this.clearHost(keeper, host);
				continue;
			}
			keeper.hosts.set(host, byFloat);
			host.addClass(HOST_CLASS);
			this.placeIn(keeper, host, topOf(host), byFloat, wanted);
		}
	}

	/**
	 * Where a planned float is now, or null when it left the note. Obsidian renders an edited section
	 * into a new element, even while it is off the page. After an edit beside the image it moves the
	 * same image element there; after an edit of the image's own link (its side, size or spacing, from
	 * another pane) it renders a new image element, in a new section at the same place in the note: the
	 * float is the one at the same place in it, showing the same picture, with its new layout. Off the
	 * page, that section's new height moves everything after it, so the float moves against the sections
	 * it reaches by the difference. Each change is recorded in `following.changes`. Measured on the
	 * fixture: without following, every stand-in of the image went and the note jumped 120px on the way
	 * back up; following without the height difference still left a 72px jump; a link edit dropped them
	 * all again (jumps of 48px to 120px).
	 */
	private follow(keeper: Keeper, floatEl: HTMLElement, following: Following): HTMLElement | null {
		const known = following.found.get(floatEl);
		if (known !== undefined) return known;
		const now = this.findAgain(keeper, floatEl, following);
		following.found.set(floatEl, now);
		return now;
	}

	private findAgain(keeper: Keeper, floatEl: HTMLElement, following: Following): HTMLElement | null {
		const { alive, heights } = following;
		const section = keeper.floatSection.get(floatEl);
		if (!section) return null;
		let el = floatEl;
		let now = section;
		if (alive.has(section) && section.contains(floatEl)) {
			// A section rendered off the page is followed until its height settles (below).
			if (section.isConnected || !keeper.renderedOff.has(section)) return floatEl;
		} else {
			const parent = floatEl.parentElement?.parentElement;
			if (parent && alive.has(parent) && floatsIn(parent).includes(floatEl)) now = parent;
			else {
				const replaced = this.replacement(keeper, floatEl, following);
				if (!replaced) return null;
				({ el, section: now } = replaced);
			}
			keeper.floatSection.set(el, now);
			if (!now.isConnected && !keeper.renderedOff.has(now)) keeper.renderedOff.set(now, undefined);
			const info = keeper.floatInfo.get(floatEl);
			if (info && el === floatEl) keeper.floatInfo.set(el, { ...info, index: following.sections.indexOf(now) });
		}
		// In the page, it is measured again instead. Off the page, Obsidian first gives a section it rendered
		// anew a guessed height, and its own a frame later (measured: 160px, then 232px, for the fixture's
		// picture): only a height seen in two plans in a row is followed, and planning goes on until then.
		const was = keeper.sectionHeight.get(floatEl);
		const height = heights.get(now);
		let delta = 0;
		if (!now.isConnected && keeper.renderedOff.has(now)) {
			const seen = keeper.renderedOff.get(now);
			keeper.renderedOff.set(now, height);
			if (height !== seen) following.followedOff = true;
			else if (was !== undefined && height !== undefined && Math.abs(height - was) >= 0.5) delta = height - was;
		}
		const settled = delta !== 0 ? height : was;
		if (settled !== undefined) keeper.sectionHeight.set(el, settled);
		const reshape = el === floatEl ? null : this.reshapeFor(keeper, floatEl, el);
		if (delta !== 0 || reshape) {
			following.changes.set(el, (box) => {
				const moved = moveFloat(box, delta);
				return reshape ? reshape(moved) : moved;
			});
		}
		return el;
	}

	/** The image that replaced `floatEl` in a section rendered anew off the page, if it shows the same picture. */
	private replacement(keeper: Keeper, floatEl: HTMLElement, following: Following): { el: HTMLElement; section: HTMLElement } | null {
		const info = keeper.floatInfo.get(floatEl);
		const section = info ? following.sections[info.index] : undefined;
		if (!info || !section || section === keeper.floatSection.get(floatEl) || section.isConnected) return null;
		const el = floatsIn(section)[info.n];
		const img = el && pictureOf(el);
		if (!el || !img || img.src !== info.src) return null;
		return { el, section };
	}

	/** How the float of `floatEl` changes into that of `el`, the image that replaced it (another side, size or spacing). */
	private reshapeFor(keeper: Keeper, floatEl: HTMLElement, el: HTMLElement): Change {
		const info = keeper.floatInfo.get(floatEl)!;
		const img = pictureOf(el)!;
		const layout = layoutFromAlt(el.getAttribute('alt'));
		const side: Side = layout.wrap === 'left' ? 'left' : 'right';
		const own = ownWidth(el, img) ?? info.own;
		keeper.floatInfo.set(el, { ...info, own });
		return (box) => reshapeFloat(box, { side, gap: layout.gap, width: drawnWidth(own, info.own, box.width, info.cap) });
	}

	/** Plans a host's stand-ins again, from the floats they were planned for, as they changed. */
	private replan(keeper: Keeper, host: HTMLElement, byFloat: Map<HTMLElement, HTMLElement>, changes: ReadonlyMap<HTMLElement, Change>): void {
		const children = Array.from(host.children);
		const entries = [...byFloat.entries()].sort(([, a], [, b]) => children.indexOf(a) - children.indexOf(b));
		const floats: Array<{ index: number; box: FloatBox }> = [];
		for (const [el, standIn] of entries) {
			const box = keeper.placed.get(standIn);
			if (!box) return;
			floats.push({ index: floats.length, box: changes.get(el)?.(box) ?? box });
		}
		const kept = new Set<number>();
		for (const plan of planHost(0, floats)) {
			const standIn = entries[plan.float]![1];
			const box = floats[plan.float]!.box;
			applyPlan(standIn, plan, box.bottom);
			keeper.placed.set(standIn, box);
			kept.add(plan.float);
		}
		// Moved up past the host's top: nothing of it reaches the host any more.
		entries.forEach(([el, standIn], i) => {
			if (kept.has(i)) return;
			standIn.remove();
			byFloat.delete(el);
		});
	}

	/**
	 * Marks a section that keeps floats to itself with the floats beside it: those measured now
	 * (`wanted`), and those measured before that are off the page now. Kept while any is beside it.
	 */
	private skipHost(keeper: Keeper, host: HTMLElement, hostTop: number, wanted: readonly Measured[], measured: ReadonlySet<HTMLElement>): void {
		const floats = keeper.skips.get(host) ?? new Map<HTMLElement, FloatBox>();
		for (const el of [...floats.keys()]) if (measured.has(el) && !wanted.some((m) => m.el === el)) floats.delete(el);
		for (const m of wanted) floats.set(m.el, floatFrom(m.box, hostTop));
		if (floats.size === 0) {
			if (keeper.skips.has(host)) this.clearSkip(keeper, host);
			return;
		}
		keeper.skips.set(host, floats);
		this.narrow(host, floats);
	}

	/** How far styles.css narrows a section that keeps floats to itself, while it is first in the page. */
	private narrow(host: HTMLElement, floats: ReadonlyMap<HTMLElement, FloatBox>): void {
		const by = narrowing(floats.values());
		host.addClass(SKIP_HOST_CLASS);
		host.setCssProps({ '--itw-skip-left': `${by.left}px`, '--itw-skip-right': `${by.right}px` });
	}

	/** Creates or updates one host's stand-ins and keeps them first in it, in the images' order. */
	private placeIn(keeper: Keeper, host: HTMLElement, hostTop: number, byFloat: Map<HTMLElement, HTMLElement>, wanted: Measured[]): void {
		wanted.sort((a, b) => a.order - b.order);
		// Stand-ins kept from images that are off the page come first (they are earlier in the note), and
		// same-side stand-ins stack below them.
		const kept = [...byFloat.entries()].filter(([el]) => !wanted.some((m) => m.el === el));
		const start: Partial<Record<Side, number>> = {};
		for (const [, standIn] of kept) {
			const side: Side = standIn.hasClass(`${STAND_IN_CLASS}-left`) ? 'left' : 'right';
			start[side] = Math.max(start[side] ?? hostTop, hostTop + Number(standIn.dataset.bottom ?? 0));
		}
		const plans = planHost(
			hostTop,
			wanted.map((m, index) => ({ index, box: m.box })),
			start,
		);
		const ordered: HTMLElement[] = kept.map(([, s]) => s);
		for (const plan of plans) {
			const m = wanted[plan.float]!;
			let standIn = byFloat.get(m.el);
			if (!standIn) {
				standIn = host.createDiv({ cls: STAND_IN_CLASS, attr: { 'aria-hidden': 'true' } });
				standIn.createDiv({ cls: PICTURE_CLASS });
				byFloat.set(m.el, standIn);
			}
			const box = floatFrom(m.box, hostTop);
			applyPlan(standIn, plan, box.bottom);
			keeper.placed.set(standIn, box);
			const src = m.img.currentSrc || m.img.src;
			if (shownSrc.get(standIn) !== src) {
				shownSrc.set(standIn, src);
				standIn.setCssProps({ '--itw-stand-in-image': cssUrl(src) });
			}
			ordered.push(standIn);
		}
		// A wanted image too short to reach past this host's top has no plan: drop its old stand-in.
		for (const m of wanted) {
			const standIn = byFloat.get(m.el);
			if (standIn && !ordered.includes(standIn)) {
				standIn.remove();
				byFloat.delete(m.el);
			}
		}
		// Stand-ins of this host for images no longer wanted were removed by the caller.
		const current = Array.from(host.children).slice(0, ordered.length);
		if (current.some((el, i) => el !== ordered[i])) host.prepend(...ordered);
	}
}
