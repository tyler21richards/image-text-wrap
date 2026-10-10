// Keeps text wrapped beside a floating image while Obsidian has taken the image's own section off the
// page (brief 7 item 9).
//
// Reading view only keeps the sections near the screen in the page. A wrapped image floats out of its
// own section into the sections below it; when Obsidian removes the image's section (scrolling down past
// a tall image) while those are still in the page, their text loses its wrap, they get shorter, and
// everything below jumps (120 px measured on test-vault/Fixture.md; none with the plugin off).
//
// Each section an image reaches gets a hidden stand-in: an empty float the size of the part of the image
// below that section's top, holding a clipped copy of the picture. styles.css shows the stand-ins of the
// first section in the page only (the one right after Obsidian's pusher element), which is exactly when
// the sections above it, the image's among them, are gone. The swap happens in the same layout pass as
// Obsidian's removal, so nothing moves. Stand-ins are planned from the page while the image's section is
// in it; a note opened at its end and scrolled up can still jump once, the first time.
//
// Adapted from Adjustable Media (src/view/readingWrap.ts and styles.css .vml-rv-proxy), MIT,
// (c) 2026 Yi-luo-hua. It needs Obsidian's list of sections (sections.ts); without it nothing is done.
import type { MarkdownView } from 'obsidian';
import { READING_IMAGES } from '../dom';
import { allSectionEls, sectionHeights, sizerOf } from './sections';
import { floatFrom, moveFloat, planHost, reachedHosts, type FloatBox, type Side, type StandIn } from './stand-in-plan';
import { wrapFromAlt } from './wraps';

export const HOST_CLASS = 'itw-host';
export const SKIP_HOST_CLASS = 'itw-host-skip';
export const STAND_IN_CLASS = 'itw-rv-stand-in';

interface Keeper {
	view: MarkdownView;
	sizer: HTMLElement;
	width: number;
	frame: number;
	mutations: MutationObserver;
	resize: ResizeObserver;
	onLoad: () => void;
	/** Each host section, with its stand-ins keyed by the floating element they copy. */
	hosts: Map<HTMLElement, Map<HTMLElement, HTMLElement>>;
	/** The section each planned float lives in. */
	floatSection: WeakMap<HTMLElement, HTMLElement>;
	/** The height Obsidian gave each planned float's section when the float was measured (sections.ts). */
	sectionHeight: WeakMap<HTMLElement, number>;
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
			hosts: new Map(),
			floatSection: new WeakMap(),
			sectionHeight: new WeakMap(),
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
		for (const host of [...keeper.hosts.keys()]) this.clearHost(keeper, host);
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
			for (const host of [...keeper.hosts.keys()]) this.clearHost(keeper, host);
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

	private clearHost(keeper: Keeper, host: HTMLElement): void {
		for (const standIn of keeper.hosts.get(host)?.values() ?? []) standIn.remove();
		host.removeClass(HOST_CLASS, SKIP_HOST_CLASS);
		keeper.hosts.delete(host);
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
		const heights = sectionHeights(keeper.view);
		const moved = new Map<HTMLElement, number>();
		for (const [host, byFloat] of [...keeper.hosts]) {
			if (!alive.has(host) || (widthChanged && !host.isConnected)) {
				this.clearHost(keeper, host);
				continue;
			}
			for (const [floatEl, standIn] of byFloat) {
				if (!this.follow(keeper, floatEl, alive, heights, moved)) {
					standIn.remove();
					byFloat.delete(floatEl);
				}
			}
		}
		if (moved.size > 0) {
			for (const [host, byFloat] of keeper.hosts) {
				if ([...byFloat.keys()].some((el) => moved.has(el))) this.replan(keeper, host, byFloat, moved);
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
		const skip = new Map<HTMLElement, boolean>();
		const want = new Map<HTMLElement, Measured[]>();
		const measured = new Set<HTMLElement>();
		attached.forEach((section, i) => {
			floatsIn(section).forEach((el, n) => {
				const side = sideOf(el);
				const img = el.instanceOf(HTMLImageElement) ? el : el.querySelector('img');
				if (!side || !img) return;
				const rect = el.getBoundingClientRect();
				if (rect.height < 1) return; // not loaded yet: planned on its load event
				const cs = el.win.getComputedStyle(el);
				const box: FloatBox = {
					side,
					top: rect.top - parseFloat(cs.marginTop),
					bottom: rect.bottom + parseFloat(cs.marginBottom),
					imgTop: img.getBoundingClientRect().top,
					width: rect.width,
					gap: parseFloat(side === 'left' ? cs.marginRight : cs.marginLeft),
				};
				measured.add(el);
				keeper.floatSection.set(el, section);
				const height = heights.get(section);
				if (height !== undefined) keeper.sectionHeight.set(el, height);
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
			if (wanted.length === 0 && byFloat.size === 0) {
				if (keeper.hosts.has(host)) this.clearHost(keeper, host);
				continue;
			}
			keeper.hosts.set(host, byFloat);
			if (skip.get(host)) {
				// It keeps floats to itself: the next host shows its stand-ins instead (styles.css).
				for (const standIn of byFloat.values()) standIn.remove();
				byFloat.clear();
				host.removeClass(HOST_CLASS);
				host.addClass(SKIP_HOST_CLASS);
				continue;
			}
			host.removeClass(SKIP_HOST_CLASS);
			host.addClass(HOST_CLASS);
			this.placeIn(keeper, host, topOf(host), byFloat, wanted);
		}
	}

	/**
	 * Whether a planned float is still in the note. Obsidian renders an edited section into a new
	 * element, even while it is off the page, and moves the same image into it: the float follows it
	 * there. Off the page that section's new height moves everything after it, so the float moves
	 * against the sections it reaches by the difference, which `moved` gets. Measured on the fixture:
	 * without following, every stand-in of the image went and the note jumped 120px on the way back
	 * up; following without the height difference still left a 72px jump.
	 */
	private follow(
		keeper: Keeper,
		floatEl: HTMLElement,
		alive: ReadonlySet<HTMLElement>,
		heights: ReadonlyMap<HTMLElement, number>,
		moved: Map<HTMLElement, number>,
	): boolean {
		const section = keeper.floatSection.get(floatEl);
		if (!section) return false;
		if (alive.has(section) && section.contains(floatEl)) return true;
		const now = floatEl.parentElement?.parentElement;
		if (!now || !alive.has(now) || !floatsIn(now).includes(floatEl)) return false;
		keeper.floatSection.set(floatEl, now);
		const was = keeper.sectionHeight.get(floatEl);
		const height = heights.get(now);
		if (height === undefined) return true;
		keeper.sectionHeight.set(floatEl, height);
		// In the page, it is measured again below instead.
		if (was !== undefined && !now.isConnected && Math.abs(height - was) >= 0.5) moved.set(floatEl, height - was);
		return true;
	}

	/** Plans a host's stand-ins again, from the floats they were planned for, with those that moved moved. */
	private replan(keeper: Keeper, host: HTMLElement, byFloat: Map<HTMLElement, HTMLElement>, moved: ReadonlyMap<HTMLElement, number>): void {
		const children = Array.from(host.children);
		const entries = [...byFloat.entries()].sort(([, a], [, b]) => children.indexOf(a) - children.indexOf(b));
		const floats: Array<{ index: number; box: FloatBox }> = [];
		for (const [el, standIn] of entries) {
			const box = keeper.placed.get(standIn);
			if (!box) return;
			floats.push({ index: floats.length, box: moveFloat(box, moved.get(el) ?? 0) });
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
				standIn.createEl('img', { attr: { alt: '', draggable: 'false' } });
				byFloat.set(m.el, standIn);
			}
			const box = floatFrom(m.box, hostTop);
			applyPlan(standIn, plan, box.bottom);
			keeper.placed.set(standIn, box);
			const copy = standIn.querySelector('img');
			const src = m.img.currentSrc || m.img.src;
			if (copy && copy.getAttribute('src') !== src) copy.setAttribute('src', src);
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
