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
// Measured here, in Obsidian 1.14:
// - A stand-in update that follows a scroll request (jump to a line or heading, going back in
//   history) carries the request again, or the target ends up away from where it was asked to be.
// - Only links Obsidian's own parser reads as images get a stand-in; it draws no picture for others.
// - A picture inside a folded section is not drawn, so it gets no stand-in either (its copy showed
//   over the section after the fold).
// - Every wrapped picture gets one: alone on its line, on a line of several, or inside a sentence
//   (without, text beside such a picture jumped by up to 192px while scrolling).
// - A picture never drawn in this editor is placed from the lines between it and the first drawn
//   line, counted as they will be drawn beside it (stand-in-plan.ts, estimateTextHeight): CodeMirror's
//   guesses for them put the copy 164px too low beside a 788px picture, and the text jumped by 72px
//   when the picture was drawn.
import { syntaxTree, syntaxTreeAvailable } from '@codemirror/language';
import {
	StateEffect,
	StateField,
	type ChangeDesc,
	type EditorState,
	type Extension,
	type Range,
	type Text,
} from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView, ViewPlugin, WidgetType, type ViewUpdate } from '@codemirror/view';
import { editorInfoField, editorLivePreviewField } from 'obsidian';
import type ImageTextWrapPlugin from '../main';
import {
	docAnchors,
	estimateBox,
	estimateTextHeight,
	linkSize,
	moveAnchors,
	planStandIn,
	rowsBefore,
	sameBox,
	stackStandIns,
	standInAnchorTop,
	type DocAnchor,
	type FloatBox,
	type FloatSide,
	type LineSample,
	type StandInPlan,
	type TextMetrics,
	withoutRanges,
} from './stand-in-plan';

export const STAND_IN_CLASS = 'itw-stand-in';

/** Stand-in updates sent within one frame before the next waits for the following frame. */
const MAX_SENDS_PER_FRAME = 3;

/** Height-map distance (px), beyond twice its height, past which a picture never drawn is not counted. */
const FAR_ABOVE = 1000;

const anchorCache = new WeakMap<Text, DocAnchor[]>();

/** The wrapped images of a document, found once per document version. */
function anchorsOf(doc: Text): DocAnchor[] {
	let anchors = anchorCache.get(doc);
	if (!anchors) {
		anchors = docAnchors(doc);
		anchorCache.set(doc, anchors);
	}
	return anchors;
}

const lineCache = new WeakMap<readonly DocAnchor[], Map<number, DocAnchor[]>>();

/** The wrapped images of a document by the start of their line. */
function anchorsByLine(doc: Text): Map<number, DocAnchor[]> {
	const anchors = anchorsOf(doc);
	let byLine = lineCache.get(anchors);
	if (!byLine) {
		byLine = new Map();
		for (const anchor of anchors) {
			const line = byLine.get(anchor.lineFrom);
			if (line) line.push(anchor);
			else byLine.set(anchor.lineFrom, [anchor]);
		}
		lineCache.set(anchors, byLine);
	}
	return byLine;
}

/**
 * The wrapped image lines after an edit: those before it, moved, when the edit cannot have changed
 * any (typing in ordinary text), so the note is not scanned on every keystroke; else found again.
 */
function anchorsAfter(update: ViewUpdate): DocAnchor[] {
	const doc = update.state.doc;
	const before = anchorCache.get(update.startState.doc);
	const moved = before && !anchorCache.has(doc) ? moveAnchors(before, update.startState.doc, update.changes, doc) : null;
	if (moved) anchorCache.set(doc, moved);
	return anchorsOf(doc);
}

/**
 * Whether Obsidian's own parser reads the link at `pos` as an image, so Live Preview draws one there.
 * It does not always agree with the link grammar ("![a [b] c|wrap-right](x.png)" is plain text to it),
 * and a stand-in for a picture that is never drawn would show a copy nobody can see in the note.
 * Where the note is not parsed yet, the link grammar decides.
 */
function drawnAsImage(state: EditorState, pos: number): boolean {
	if (!syntaxTreeAvailable(state, pos + 1)) return true;
	const tokens = syntaxTree(state).resolveInner(pos, 1).name.split('_');
	return tokens.includes('image-marker') || tokens.includes('formatting-embed');
}

/** The type of CodeMirror's scroll requests (scrollIntoView, scrollSnapshot), which it does not export. */
const SCROLL_REQUEST: unknown = (EditorView.scrollIntoView(0) as unknown as { type?: unknown }).type;

function isScrollRequest(effect: StateEffect<unknown>): boolean {
	return SCROLL_REQUEST !== undefined && (effect as unknown as { type?: unknown }).type === SCROLL_REQUEST;
}

/** A scroll request the stand-ins may still move away from: an effect, or the selection's own scroll. */
interface PendingScroll {
	effect: StateEffect<unknown> | null;
	/** When it was made (Date.now()). */
	at: number;
	/** Asked for once more after lines changed height (StandInGuard.update). */
	again: boolean;
}

/** Frames after a scroll request during which stand-in updates carry it again (see StandInGuard.place). */
const SCROLL_FOLLOW_FRAMES = 3;
/** A safety net for those frames: never carry a request older than this, in ms. */
const SCROLL_FOLLOW_MS = 500;

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
	private pendingScroll: PendingScroll | null = null;
	/** Scroll requests this guard sent itself, which are not new requests. */
	private readonly ownScrolls = new WeakSet<StateEffect<unknown>>();
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
			else {
				anchorsAfter(update);
				this.mapSizes(update.changes, update.state.doc);
			}
		}
		this.noteScroll(update);
		this.followScroll(update);
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
		this.pendingScroll = null;
		this.resize.disconnect();
		this.observed.clear();
		liveGuards.delete(this);
	}

	private livePreview(): boolean {
		return this.view.state.field(editorLivePreviewField, false) === true;
	}

	/**
	 * Remembers a scroll request (jump to a line or heading, search, going back in history) for a few
	 * frames. CodeMirror scrolls to it once, in its next measure, and then keeps its own scroll anchor
	 * still instead. When that scroll draws lines beside a picture whose own line is no longer drawn,
	 * their stand-in only follows in another transaction, the text beside it wraps again and grows,
	 * and the target ends up off the window's top (measured: 22px above it, and 168px after going
	 * back in history). So the stand-in update carries the request again (place).
	 */
	private noteScroll(update: ViewUpdate): void {
		for (const tr of update.transactions) {
			if (this.pendingScroll?.effect && !tr.changes.empty) {
				// Kept as the same object: its frame count (below) follows it.
				const effect = this.pendingScroll.effect.map(tr.changes);
				if (effect) this.pendingScroll.effect = effect;
				else this.pendingScroll = null;
			}
			// Our own updates may carry one again; that is not a new request.
			if (tr.effects.some((e) => e.is(setStandIns) || this.ownScrolls.has(e))) continue;
			const effect = tr.effects.filter(isScrollRequest).pop();
			if (!effect && !tr.scrollIntoView) continue;
			const pending: PendingScroll = { effect: effect ?? null, at: Date.now(), again: false };
			this.pendingScroll = pending;
			const win = this.view.dom.win;
			let frames = SCROLL_FOLLOW_FRAMES;
			const tick = () => {
				if (this.pendingScroll !== pending) return;
				if (--frames <= 0) this.pendingScroll = null;
				else win.requestAnimationFrame(tick);
			};
			win.requestAnimationFrame(tick);
		}
	}

	/**
	 * Asks once more for a scroll request when CodeMirror measured lines of other heights after it
	 * scrolled to it. CodeMirror keeps no scroll anchor in the measure that applied the request, so
	 * the target moves by as much as the lines above it changed (measured on the fixture: Obsidian drew
	 * the note's first line, a heading, apart and 23px shorter in that measure, and the line jumped to
	 * stayed 21px above the window's top; with the plugin off the same change came a frame later and
	 * CodeMirror kept the line in place).
	 */
	private followScroll(update: ViewUpdate): void {
		const scroll = this.pendingScroll;
		if (!scroll?.effect || scroll.again || !update.heightChanged || update.transactions.length > 0) return;
		if (Date.now() - scroll.at > SCROLL_FOLLOW_MS) return;
		scroll.again = true;
		const doc = update.state.doc;
		queueMicrotask(() => {
			if (this.destroyed || this.pendingScroll !== scroll || !scroll.effect || this.view.state.doc !== doc) return;
			this.ownScrolls.add(scroll.effect);
			this.view.dispatch({ effects: scroll.effect });
		});
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
	private floatFor(anchor: DocAnchor): { box: FloatBox; src: string } | null {
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
	private resolve(anchor: DocAnchor): string | null {
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
			// A scroll request from just before: the text re-wraps beside the new stand-ins, so CodeMirror
			// scrolls to it again once it has measured them (noteScroll).
			const scroll = this.pendingScroll && Date.now() - this.pendingScroll.at <= SCROLL_FOLLOW_MS ? this.pendingScroll : null;
			this.view.dispatch({
				effects: scroll?.effect ? [setStandIns.of(Decoration.set(ranges, true)), scroll.effect] : setStandIns.of(Decoration.set(ranges, true)),
				scrollIntoView: !!scroll && !scroll.effect,
			});
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

	private textMetrics(side: FloatSide, metrics: LineMetrics): TextMetrics {
		return {
			lineWidth: metrics.width,
			lineInset: side === 'left' ? metrics.insetLeft : metrics.insetRight,
			charWidth: this.view.defaultCharacterWidth,
			lineHeight: this.view.defaultLineHeight,
		};
	}

	/** The text of `anchor`'s line without its wrapped pictures, up to `upTo` (an offset in the line). */
	private lineText(anchor: DocAnchor, upTo?: number): string {
		const doc = this.view.state.doc;
		const text = doc.sliceString(anchor.lineFrom, anchor.lineTo);
		const links = (anchorsByLine(doc).get(anchor.lineFrom) ?? []).map((a) => ({ from: a.linkFrom, to: a.linkTo }));
		return withoutRanges(upTo === undefined ? text : text.slice(0, upTo), links);
	}

	/**
	 * How far above the line at `to` the top of `anchor`'s line is, for a picture never drawn here
	 * (estimateTextHeight): the lines between are counted as they will be drawn beside it, and so is
	 * the picture's own line when it holds text too.
	 */
	private textBetween(anchor: DocAnchor, to: number, box: FloatBox, metrics: LineMetrics): number {
		const view = this.view;
		const doc = view.state.doc;
		const byLine = anchorsByLine(doc);
		const own = anchor.alone ? null : this.lineText(anchor);
		function* blocks(): Generator<LineSample> {
			if (own !== null) yield { text: own, mapHeight: view.lineBlockAt(anchor.lineFrom).height, floats: false };
			for (let pos = anchor.lineTo + 1; pos < to; ) {
				const block = view.lineBlockAt(pos);
				const line = doc.lineAt(pos);
				const single = block.from === line.from && block.to === line.to;
				yield { text: single ? line.text : null, mapHeight: block.height, floats: single && !!byLine.get(line.from)?.[0]?.alone };
				pos = block.to + 1;
			}
		}
		const limit = box.layoutTop + box.height + box.marginBottom;
		return estimateTextHeight(blocks(), box, this.textMetrics(box.side, metrics), limit, anchor.alone ? 0 : box.layoutTop);
	}

	/** The stand-in in front of the first drawn line (at `at`, height-map top `lineTop`), if any. */
	private standInsBefore(at: number, lineTop: number): Range<Decoration> | null {
		const view = this.view;
		const doc = view.state.doc;
		const viewportFrom = view.viewport.from;
		if (viewportFrom === 0) return null;
		const planned: Array<{ anchor: DocAnchor; box: FloatBox; src: string; plan: StandInPlan }> = [];
		// Pictures CodeMirror draws apart, on the cursor's line, start before any stand-in.
		let floor = 0;
		// Estimated pictures on one line of several: same-side ones stack, as CSS stacks them.
		let stackLine = -1;
		const stack: Record<FloatSide, number> = { left: 0, right: 0 };
		for (const anchor of anchorsOf(doc)) {
			if (anchor.lineFrom >= viewportFrom) break;
			// Inside a folded section (or anything else drawn as one block over several lines) the
			// picture is not drawn, so neither is its copy.
			const block = view.lineBlockAt(anchor.lineFrom);
			if (block.from !== anchor.lineFrom || block.to !== anchor.lineTo) continue;
			if (!drawnAsImage(view.state, anchor.pos)) continue;
			let float = this.floatFor(anchor);
			if (!float) continue;
			const anchorTop = block.top;
			if (onSelectionLine(view, anchor.lineFrom, anchor.lineTo)) {
				floor = Math.max(floor, anchorTop + float.box.layoutTop - float.box.marginTop - lineTop);
				continue;
			}
			const { refPos } = float.box;
			let top: number;
			if (float.box.refOffset === undefined && this.metrics) {
				// Never drawn here: placed from the line in front of which it goes, not from the height map.
				// A picture inside a sentence starts on the row of text its link is on. Lines are drawn about
				// as tall as the height map guesses or taller, image lines aside, so one far above is skipped
				// without counting the lines between.
				if (lineTop - anchorTop > 2 * (float.box.height + float.box.marginBottom) + FAR_ABOVE) continue;
				if (stackLine !== anchor.lineFrom) {
					stackLine = anchor.lineFrom;
					stack.left = stack.right = 0;
				}
				const layoutTop = anchor.alone
					? stack[float.box.side]
					: rowsBefore(this.lineText(anchor, anchor.linkFrom), this.textMetrics(float.box.side, this.metrics));
				const box = { ...float.box, layoutTop };
				stack[box.side] = layoutTop + box.height + box.marginBottom;
				float = { ...float, box };
				top = lineTop - this.textBetween(anchor, at, box, this.metrics);
			} else {
				const refTop = refPos !== undefined && refPos <= doc.length ? view.lineBlockAt(refPos).top : null;
				top = standInAnchorTop(float.box, anchorTop, refTop);
			}
			const plan = planStandIn(top, float.box, lineTop);
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

/**
 * Plans every editor's stand-ins again. Their sizes are fixed when they are planned, so a change to
 * "Widest wrapped image" reaches them only through this; nothing in the editor changes by itself
 * while a picture's own line is not drawn.
 */
export function refreshStandIns(): void {
	for (const guard of liveGuards) {
		guard.place();
		guard.measure();
	}
}

export function standInExtension(plugin: ImageTextWrapPlugin): Extension {
	return [standInField, ViewPlugin.define((view) => new StandInGuard(view, plugin))];
}
