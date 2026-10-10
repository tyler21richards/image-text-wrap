// Keeps wrapping correct when CodeMirror stops drawing a wrapped image's own line (brief 7 item 6).
//
// CodeMirror draws only the lines near the window. A wrapped image floats out of its own line, which
// takes no height, so a tall picture still reaches far below that line. When the line leaves the
// drawn range while the text beside the picture is drawn, that text loses its wrap and the note jumps
// (measured on the fixture without this: jumps of 72 to 120px, and text running under the picture).
// So whenever a wrapped image's line is above the first drawn line but its picture reaches into the
// drawn part, a stand-in goes in front of the first drawn line: a zero-height block widget holding a
// display-only copy of the picture, floated to the same side, with the same size and margins, and
// pulled up by as much as the real picture starts above that line.
//
// Adapted from Adjustable Media (src/view/wrapGuard.ts: proxyField, ProxyWidget, WrapGuard.measure,
// remember and placeProxies), MIT, (c) 2026 Yi-luo-hua. Its rules, each measured there, apply here:
// - Block widgets can only come from state, so the plan is sent as an effect, from a microtask:
//   never inside requestMeasure's read or a ViewPlugin update. A serial drops stale plans.
// - The widget is 0 high (estimatedHeight 0) and holds only floats, so the height map stays true.
//   It is never put inside a .cm-line: a list or quote line, laid out on its own, would grow to
//   contain the float (measured there: 50px to 982px).
// - Stand-ins in front of lines no longer drawn stay until those lines are drawn again: changing an
//   undrawn line's decorations makes CodeMirror forget its measured height (measured there: 98px).
// - CodeMirror also draws the lines holding the cursor. An image there is drawn for real, so it gets
//   no stand-in, and stand-ins left on such lines go.
// Here the copy is a plain picture rather than an interactive layout: clicking it does nothing.
import { StateEffect, StateField, type ChangeDesc, type Extension, type Range, type Text } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType, type ViewUpdate } from '@codemirror/view';
import { editorInfoField, editorLivePreviewField } from 'obsidian';
import type ImageTextWrapPlugin from '../main';
import {
	estimateBox,
	findFloatAnchors,
	linkSize,
	planStandIn,
	sameBox,
	stackStandIns,
	standInAnchorTop,
	type FloatAnchor,
	type FloatBox,
	type FloatSide,
	type StandInPlan,
} from './stand-in-plan';

export const STAND_IN_CLASS = 'itw-stand-in';

/** Stand-in updates sent within one frame before the next waits for the following frame. */
const MAX_SENDS_PER_FRAME = 3;

/** A wrapped image line, with document positions. */
interface Anchor extends FloatAnchor {
	lineFrom: number;
	lineTo: number;
	/** Document position of the link: where CodeMirror puts the image widget. */
	pos: number;
}

const anchorCache = new WeakMap<Text, Anchor[]>();

/** The wrapped image lines of a document, computed once per document version. */
function anchorsOf(doc: Text): Anchor[] {
	let anchors = anchorCache.get(doc);
	if (anchors) return anchors;
	anchors = [];
	let any = false;
	for (const iter = doc.iterLines(); !iter.next().done; ) {
		if (iter.value.includes('wrap-left') || iter.value.includes('wrap-right')) {
			any = true;
			break;
		}
	}
	if (any) {
		const lines = doc.toString().split('\n');
		for (const found of findFloatAnchors(lines)) {
			const line = doc.line(found.line + 1);
			anchors.push({ ...found, lineFrom: line.from, lineTo: line.to, pos: line.from + found.linkFrom });
		}
	}
	anchorCache.set(doc, anchors);
	return anchors;
}

/** What was measured on a drawn image, kept while its line is not drawn. */
interface Measured {
	box: FloatBox;
	/** The link text it was measured with; any edit to the link makes the size untrustworthy. */
	raw: string;
	/** Whether the picture reaches below its own line at all (inside a list it would not). */
	leaks: boolean;
	src: string;
	natural: { width: number; height: number };
	lineWidth: number;
	maxPercent: number;
}

/** Sizes of the note column's lines, for pictures never drawn. */
interface LineMetrics {
	width: number;
	insetLeft: number;
	insetRight: number;
}

interface StandInItem {
	pos: number;
	side: FloatSide;
	box: FloatBox;
	sandbag: number;
	marginTop: number;
	shift: number;
	src: string;
}

const px = (n: number) => `${Math.round(n * 100) / 100}px`;

function itemKey(item: StandInItem): string {
	const b = item.box;
	return [item.pos, item.side, b.width, b.height, b.margin, b.inset, b.marginBottom, item.sandbag, item.marginTop, item.shift]
		.map((n) => (typeof n === 'number' ? n.toFixed(1) : n))
		.concat(item.src)
		.join(',');
}

/** The pictures in front of one drawn line, in document order. Display only. */
class StandInWidget extends WidgetType {
	readonly key: string;

	constructor(readonly items: readonly StandInItem[]) {
		super();
		this.key = items.map(itemKey).join(';');
	}

	eq(other: StandInWidget): boolean {
		return other.key === this.key;
	}

	get estimatedHeight(): number {
		return 0;
	}

	ignoreEvent(): boolean {
		return true;
	}

	toDOM(view: EditorView): HTMLElement {
		// The editor's own window, so a pop-out window gets its own elements.
		const root = (view.dom.win as typeof window).createDiv({ cls: STAND_IN_CLASS, attr: { 'aria-hidden': 'true' } });
		this.fill(root);
		return root;
	}

	// Moving to another line or changing size keeps the pictures already loaded, so nothing flickers.
	updateDOM(dom: HTMLElement): boolean {
		this.fill(dom);
		return true;
	}

	// Always the full copy: CodeMirror may draw this widget during a measure pass with another viewport
	// and keep it, so hiding it there would leave it empty where it is needed (measured on a jump).
	private fill(root: HTMLElement): void {
		const items = this.items;
		const old = new Map<string, HTMLImageElement>();
		for (const img of Array.from(root.querySelectorAll('img'))) old.set(img.getAttribute('src') ?? '', img);
		root.empty();
		for (const item of items) {
			if (item.sandbag > 0) {
				const bag = root.createDiv({ cls: `itw-stand-in-sandbag mod-${item.side}` });
				bag.setCssProps({ '--itw-stand-in-sandbag': px(item.sandbag) });
			}
			const float = root.createDiv({ cls: `itw-stand-in-float mod-${item.side}`, attr: { 'data-from': String(item.pos) } });
			const b = item.box;
			float.setCssProps({
				'--itw-stand-in-width': px(b.width),
				'--itw-stand-in-height': px(b.height),
				'--itw-stand-in-margin-top': px(item.marginTop),
				'--itw-stand-in-margin-bottom': px(b.marginBottom),
				'--itw-stand-in-gap': px(b.margin),
				'--itw-stand-in-inset': px(b.inset),
				'--itw-stand-in-clip': px(item.shift),
			});
			const img = old.get(item.src);
			if (img) {
				old.delete(item.src);
				float.appendChild(img);
			} else {
				float.createEl('img', { attr: { src: item.src, alt: '', draggable: 'false' } });
			}
		}
	}
}

const setStandIns = StateEffect.define<DecorationSet>();

// Block widgets change the height map, so CodeMirror only takes them from state, not from plugins.
const standInField = StateField.define<DecorationSet>({
	create: () => Decoration.none,
	update(value, tr) {
		let next = value.map(tr.changes);
		for (const effect of tr.effects) if (effect.is(setStandIns)) next = effect.value;
		return next;
	},
	provide: (field) => EditorView.decorations.from(field),
});

/** Whether `from`..`to` meets a line the main selection starts or ends on: CodeMirror always draws those. */
function onSelectionLine(view: EditorView, from: number, to = from): boolean {
	const { main } = view.state.selection;
	return [main.anchor, main.head].some((pos) => {
		const line = view.state.doc.lineAt(pos);
		return line.from <= to && line.to >= from;
	});
}

/** Natural sizes of pictures by URL, shared by every editor. */
const naturalSizes = new Map<string, { width: number; height: number } | 'loading' | 'failed'>();
const liveGuards = new Set<StandInGuard>();

function naturalSize(src: string, doc: Document): { width: number; height: number } | null {
	const known = naturalSizes.get(src);
	if (known === 'loading' || known === 'failed') return null;
	if (known) return known;
	naturalSizes.set(src, 'loading');
	// Not attached anywhere: it only loads, to learn the picture's size.
	const img = (doc.win as typeof window).createEl('img');
	img.onload = () => {
		naturalSizes.set(src, { width: img.naturalWidth, height: img.naturalHeight });
		for (const guard of liveGuards) guard.place();
	};
	img.onerror = () => naturalSizes.set(src, 'failed');
	img.src = src;
	return null;
}

interface Reading {
	entries: Array<Omit<Measured, 'lineWidth' | 'maxPercent'> & { pos: number }>;
	metrics: LineMetrics | null;
	marginBottom: number | null;
	embeds: HTMLElement[];
	/** The first line of CodeMirror's viewport is not in the page (see repairStaleDraw). */
	stale: boolean;
}

class StandInGuard {
	/** Measured floats by link position, mapped through edits. */
	private sizes = new Map<number, Measured>();
	private metrics: LineMetrics | null = null;
	private marginBottom = 0;
	private destroyed = false;
	private serial = 0;
	private sentKey = '';
	private sentThisFrame = 0;
	private measureSerial = 0;
	private measureQueued = false;
	private repairs = 0;
	private readonly resize: ResizeObserver;
	private readonly observed = new Set<HTMLElement>();

	constructor(
		private readonly view: EditorView,
		private readonly plugin: ImageTextWrapPlugin,
	) {
		liveGuards.add(this);
		// From the editor's own window, so pop-out windows work.
		const win = view.dom.win as typeof window;
		this.resize = new win.ResizeObserver(() => {
			if (!this.destroyed) this.measure();
		});
		this.measure();
		this.place();
	}

	update(update: ViewUpdate): void {
		if (update.docChanged) {
			// Another note loaded into this editor replaces everything: nothing measured applies.
			if (update.changes.touchesRange(0, update.startState.doc.length) === 'cover') this.sizes.clear();
			else this.mapSizes(update.changes, update.state.doc);
		}
		const modeChanged = update.startState.field(editorLivePreviewField, false) !== update.state.field(editorLivePreviewField, false);
		// Our own stand-ins change decorations on drawn lines, so CodeMirror estimates those lines again
		// and may pick another viewport within the same update. Planning again from that would send new
		// stand-ins from a microtask, and so on without end (measured: the window froze). The next
		// measured frame plans again instead, with real heights.
		const ownOnly =
			!update.docChanged &&
			!update.selectionSet &&
			!modeChanged &&
			update.transactions.length > 0 &&
			update.transactions.every((tr) => tr.effects.some((e) => e.is(setStandIns)));
		if (
			!ownOnly &&
			(update.docChanged ||
				update.viewportChanged ||
				update.heightChanged ||
				update.geometryChanged ||
				update.selectionSet ||
				modeChanged)
		) {
			this.place();
		}
		// Pictures change size only when drawn anew, edited, loaded (the resize observer) or when the
		// column changes width; the height map moving does not change them.
		if (ownOnly || update.docChanged || update.viewportChanged || update.geometryChanged) this.measure();
	}

	destroy(): void {
		this.destroyed = true;
		this.serial++;
		this.resize.disconnect();
		this.observed.clear();
		liveGuards.delete(this);
	}

	private livePreview(): boolean {
		return this.view.state.field(editorLivePreviewField, false) === true;
	}

	// The link start: typing in front of the picture leaves the size behind (it is measured again, as
	// that line is drawn), but rewriting the link itself keeps it, for the same picture. Sizes no
	// longer at a picture are dropped.
	private mapSizes(changes: ChangeDesc, doc: Text): void {
		const pictures = new Set(anchorsOf(doc).map((a) => a.pos));
		const next = new Map<number, Measured>();
		for (const [pos, m] of this.sizes) {
			const at = changes.mapPos(pos, -1);
			if (!pictures.has(at)) continue;
			const box = m.box.refPos === undefined ? m.box : { ...m.box, refPos: changes.mapPos(m.box.refPos, 1) };
			next.set(at, { ...m, box });
		}
		this.sizes = next;
	}

	/**
	 * Measures every drawn wrapped image in the next frame, after CodeMirror has laid it out.
	 * The request is made from a microtask, not during an update: CodeMirror only scrolls to a
	 * scroll target (jump to a line, search) once a measure pass has no requests left, and a request
	 * added by every update kept it from ever doing so (measured: "Measure loop restarted more than
	 * 5 times" on every frame, and the jump never happened).
	 */
	measure(): void {
		if (this.measureQueued || this.destroyed) return;
		this.measureQueued = true;
		queueMicrotask(() => {
			this.measureQueued = false;
			if (this.destroyed || !this.livePreview() || anchorsOf(this.view.state.doc).length === 0) return;
			const serial = ++this.measureSerial;
			const doc = this.view.state.doc;
			const current = () => !this.destroyed && this.measureSerial === serial && this.view.state.doc === doc;
			this.view.requestMeasure<Reading | null>({
				key: this,
				read: () => (current() ? this.read() : null),
				write: (reading) => {
					if (reading && current()) this.write(reading);
				},
			});
		});
	}

	private read(): Reading {
		const view = this.view;
		const docTop = view.documentTop;
		const byPos = new Map(anchorsOf(view.state.doc).map((a) => [a.pos, a]));
		const content = view.contentDOM;
		const cRect = content.getBoundingClientRect();
		const cStyle = getComputedStyle(content);
		const colLeft = cRect.left + (parseFloat(cStyle.borderLeftWidth) || 0) + (parseFloat(cStyle.paddingLeft) || 0);
		const colRight = cRect.right - (parseFloat(cStyle.borderRightWidth) || 0) - (parseFloat(cStyle.paddingRight) || 0);
		const reading: Reading = { entries: [], metrics: null, marginBottom: null, embeds: [], stale: false };

		for (const embed of Array.from(content.querySelectorAll<HTMLElement>('.image-embed'))) {
			if (embed.closest(`.${STAND_IN_CLASS}`)) continue;
			let pos: number;
			try {
				pos = view.posAtDOM(embed);
			} catch {
				continue;
			}
			const anchor = byPos.get(pos);
			if (!anchor) continue;
			reading.embeds.push(embed);
			const img = embed.querySelector('img');
			// Not loaded yet: its size will change. The resize observer measures it again then.
			if (!img || !img.complete || !img.naturalWidth) continue;
			const rect = embed.getBoundingClientRect();
			const style = getComputedStyle(embed);
			const side: FloatSide | null = style.float === 'left' ? 'left' : style.float === 'right' ? 'right' : null;
			if (!side || rect.height <= 0) continue;
			const marginTop = parseFloat(style.marginTop) || 0;
			const marginBottom = parseFloat(style.marginBottom) || 0;
			const marginLeft = parseFloat(style.marginLeft) || 0;
			const marginRight = parseFloat(style.marginRight) || 0;
			const lineRect = embed.closest('.cm-line')?.getBoundingClientRect();
			const top = rect.top - docTop;
			// The line beside the picture's top, as the height map has it: the stand-in follows that line.
			const beside = view.lineBlockAtHeight(top);
			reading.marginBottom = marginBottom;
			reading.entries.push({
				pos,
				raw: anchor.raw,
				leaks: !!lineRect && rect.bottom + marginBottom > lineRect.bottom + 1,
				src: img.currentSrc || img.src,
				natural: { width: img.naturalWidth, height: img.naturalHeight },
				box: {
					side,
					layoutTop: top - view.lineBlockAt(anchor.lineFrom).top,
					width: rect.width,
					height: rect.height,
					margin: side === 'left' ? marginRight : marginLeft,
					inset: side === 'left' ? rect.left - colLeft : colRight - rect.right,
					marginTop,
					marginBottom,
					refPos: beside.from,
					refOffset: top - beside.top,
				},
			});
		}

		// A plain text line gives the column's line width, for pictures never drawn.
		for (const line of Array.from(content.querySelectorAll<HTMLElement>(':scope > .cm-line'))) {
			if (line.querySelector('.image-embed') || line.style.textIndent) continue;
			const r = line.getBoundingClientRect();
			if (r.width <= 0) continue;
			const s = getComputedStyle(line);
			const left = r.left + (parseFloat(s.paddingLeft) || 0);
			const right = r.right - (parseFloat(s.paddingRight) || 0);
			reading.metrics = { width: right - left, insetLeft: left - colLeft, insetRight: colRight - right };
			break;
		}

		const first = view.lineBlockAt(view.viewport.from).from;
		reading.stale = !Array.from(content.children).some((child) => {
			if (child.hasClass('cm-gap')) return false;
			try {
				return view.posAtDOM(child) === first;
			} catch {
				return false;
			}
		});
		return reading;
	}

	/**
	 * CodeMirror gives up a measure cycle after six passes, and when the last pass picked a new
	 * viewport it leaves the old lines in the page until something else updates the view. Text
	 * beside floats keeps changing height while CodeMirror converges, so a jump to a line next to
	 * wrapped pictures can run out of passes (measured on a jump straight after opening a note:
	 * without stand-ins the note stayed blank below its first line; with them, the lines holding a
	 * picture just above the jump target stayed undrawn). Any update makes CodeMirror draw its
	 * viewport again, so an empty one is sent. Twice at most, until the page matches again.
	 */
	private repairStaleDraw(stale: boolean): void {
		if (!stale) {
			this.repairs = 0;
			return;
		}
		if (this.repairs >= 2) return;
		this.repairs++;
		queueMicrotask(() => {
			if (!this.destroyed) this.view.dispatch({});
		});
	}

	private write(reading: Reading): void {
		this.repairStaleDraw(reading.stale);
		const seen = new Set(reading.embeds);
		for (const el of this.observed) {
			if (!seen.has(el)) {
				this.resize.unobserve(el);
				this.observed.delete(el);
			}
		}
		for (const el of reading.embeds) {
			if (!this.observed.has(el)) {
				this.observed.add(el);
				this.resize.observe(el);
			}
		}
		let changed = false;
		if (reading.metrics && (!this.metrics || Math.abs(reading.metrics.width - this.metrics.width) >= 0.5)) {
			this.metrics = reading.metrics;
			changed = true;
		}
		if (reading.marginBottom !== null) this.marginBottom = reading.marginBottom;
		const lineWidth = this.metrics?.width ?? 0;
		const maxPercent = this.plugin.settings.maxWrapWidth;
		for (const { pos, ...entry } of reading.entries) {
			const old = this.sizes.get(pos);
			naturalSizes.set(entry.src, entry.natural);
			if (
				old &&
				old.raw === entry.raw &&
				old.src === entry.src &&
				old.leaks === entry.leaks &&
				old.maxPercent === maxPercent &&
				Math.abs(old.lineWidth - lineWidth) < 0.5 &&
				sameBox(old.box, entry.box)
			) {
				continue;
			}
			this.sizes.set(pos, { ...entry, lineWidth, maxPercent });
			changed = true;
		}
		if (changed) this.place();
	}

	/** The picture's float and URL: as measured, or estimated for one never drawn here. */
	private floatFor(anchor: Anchor): { box: FloatBox; src: string } | null {
		const m = this.sizes.get(anchor.pos);
		const maxPercent = this.plugin.settings.maxWrapWidth;
		const metrics = this.metrics;
		if (m && m.raw === anchor.raw && m.maxPercent === maxPercent && (!metrics || Math.abs(m.lineWidth - metrics.width) < 0.5)) {
			return m.leaks ? { box: m.box, src: m.src } : null;
		}
		if (!metrics) return null;
		const src = m?.src ?? this.resolve(anchor);
		if (!src) return null;
		const natural = m?.natural ?? naturalSize(src, this.view.dom.ownerDocument);
		const box = estimateBox({
			side: anchor.side,
			size: linkSize(anchor.link),
			natural,
			lineWidth: metrics.width,
			lineInset: anchor.side === 'left' ? metrics.insetLeft : metrics.insetRight,
			maxPercent,
			gap: anchor.gap,
			marginBottom: this.marginBottom,
		});
		return box ? { box, src } : null;
	}

	/** The URL Obsidian would show the picture from. */
	private resolve(anchor: Anchor): string | null {
		let target = anchor.link.target.trim().replace(/^<|>$/g, '');
		if (/^(https?:|data:|app:|file:)/i.test(target)) return target;
		if (anchor.link.kind === 'markdown') {
			try {
				target = decodeURI(target);
			} catch {
				/* keep as written */
			}
		}
		const path = target.split('#')[0]!.trim();
		const source = this.view.state.field(editorInfoField, false)?.file?.path ?? '';
		const file = this.plugin.app.metadataCache.getFirstLinkpathDest(path, source);
		return file ? this.plugin.app.vault.getResourcePath(file) : null;
	}

	/**
	 * Plans the stand-ins for the drawn range and sends them to standInField. A view may not dispatch
	 * while it updates, so they follow in a microtask, before the frame is painted.
	 */
	place(): void {
		if (this.destroyed) return;
		const view = this.view;
		const state = view.state;
		const current = state.field(standInField, false);
		if (current === undefined) return;
		const ranges: Array<Range<Decoration>> = [];
		if (this.livePreview()) {
			const viewport = view.viewport;
			const first = view.lineBlockAt(viewport.from);
			current.between(0, state.doc.length, (from, _to, value) => {
				if ((from < first.from || from > viewport.to) && !onSelectionLine(view, from)) ranges.push(value.range(from));
			});
			const fresh = this.standInsBefore(first.from, first.top);
			if (fresh) ranges.push(fresh);
		}
		const key = ranges.map((r) => `${r.from}:${(r.value.spec as { widget: StandInWidget }).widget.key}`).join('|');
		// A newer plan replaces one still waiting to be sent, even when it is what the field has.
		const serial = ++this.serial;
		if (key === this.sentKey) return;
		const doc = state.doc;
		const send = () => {
			if (this.destroyed || this.serial !== serial || this.view.state.doc !== doc) return;
			this.sentKey = key;
			this.countSend();
			this.view.dispatch({ effects: setStandIns.of(Decoration.set(ranges, true)) });
		};
		// A safety net under the rule in update(): past a few sends in one frame, wait for the next.
		if (this.sentThisFrame < MAX_SENDS_PER_FRAME) queueMicrotask(send);
		else this.view.dom.win.requestAnimationFrame(send);
	}

	private countSend(): void {
		if (this.sentThisFrame++ === 0) {
			this.view.dom.win.requestAnimationFrame(() => {
				this.sentThisFrame = 0;
			});
		}
	}

	/** The stand-in in front of the first drawn line (at `at`, height-map top `lineTop`), if any. */
	private standInsBefore(at: number, lineTop: number): Range<Decoration> | null {
		const view = this.view;
		const doc = view.state.doc;
		const viewportFrom = view.viewport.from;
		if (viewportFrom === 0) return null;
		const planned: Array<{ anchor: Anchor; box: FloatBox; src: string; plan: StandInPlan }> = [];
		// Pictures CodeMirror draws apart, on the cursor's line, start before any stand-in.
		let floor = 0;
		for (const anchor of anchorsOf(doc)) {
			if (anchor.lineFrom >= viewportFrom) break;
			const float = this.floatFor(anchor);
			if (!float) continue;
			const anchorTop = view.lineBlockAt(anchor.lineFrom).top;
			if (onSelectionLine(view, anchor.lineFrom, anchor.lineTo)) {
				floor = Math.max(floor, anchorTop + float.box.layoutTop - float.box.marginTop - lineTop);
				continue;
			}
			const { refPos } = float.box;
			const refTop = refPos !== undefined && refPos <= doc.length ? view.lineBlockAt(refPos).top : null;
			const plan = planStandIn(standInAnchorTop(float.box, anchorTop, refTop), float.box, lineTop);
			if (plan) planned.push({ anchor, ...float, plan });
		}
		if (planned.length === 0) return null;
		const plans = stackStandIns(
			planned.map((p) => p.plan),
			floor,
		);
		const items = planned.map(
			(p, i): StandInItem => ({
				pos: p.anchor.pos,
				side: p.box.side,
				box: p.box,
				sandbag: plans[i]!.sandbag,
				marginTop: plans[i]!.marginTop,
				shift: plans[i]!.shift,
				src: p.src,
			}),
		);
		// In front of other block widgets at the line (side -2), so the float starts at the line's top.
		return Decoration.widget({ widget: new StandInWidget(items), block: true, side: -2 }).range(at);
	}
}

export function standInExtension(plugin: ImageTextWrapPlugin): Extension {
	return [standInField, ViewPlugin.define((view) => new StandInGuard(view, plugin))];
}
