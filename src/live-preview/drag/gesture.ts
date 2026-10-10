// One press on one image in one Live Preview editor, from the press to the drop (brief 4.3, 6.3).
//
// Nothing happens until the pointer has moved more than 5 px, so a click still selects the image, a
// second click still opens the viewer, and the resize corner (a different element) is never tracked.
// Past that, the image is dragged: a ghost follows the pointer, the indicator shows where it will land,
// and the note scrolls near the editor's edges. The move is planned on the note as it was when the drag
// started, and written as one transaction on release, only if the note has not changed since. The view is
// then held so the image appears where the indicator was, while the text around it settles (keep-scroll.ts).
//
// The flow (targets found once from the text, placed on screen through CodeMirror's height map, the
// rAF auto-scroll loop, the commit) follows Adjustable Media (src/view/blockDrag.ts, src/view/plainDrag.ts),
// MIT, (c) 2026 Yi-luo-hua.
import type { Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { Notice } from 'obsidian';
import { EMBED, PANE } from '../../dom';
import { CHANGED_ELSEWHERE, USER_EVENT, dispatchOwn } from '../../edit/write';
import type { LocatedLink } from '../../edit/locate';
import { relayout, type ImageLink, type Wrap } from '../../grammar';
import { dropTargets, scanLines, type LineInfo } from '../../markdown/lines';
import { dropZones, planMove, type MovePlan } from '../../markdown/move';
import { keepLineAt } from '../keep-scroll';
import { clamp, nearestTarget, pastThreshold, scrollSpeed, sideAt, type Side } from './geometry';
import { DragGhost, DropIndicator, type Rect } from './overlay';
import { swallowNextClick, trackPointer, type TrackedPointer } from './pointer';

/** On the window's body while an image is dragged: grabbing cursor, no tooltips (styles.css). */
export const BODY_CLASS = 'itw-dragging';
/** On the dragged image's embed: dimmed while it is moved. */
export const SOURCE_CLASS = 'itw-drag-source';
/**
 * The copy of a wrapped picture that stand-ins.ts draws while the picture's own line is not drawn. Floated
 * like the picture; `data-from` holds the position of its link.
 */
const STAND_IN_FLOAT = '.itw-stand-in-float';

const LABELS: Record<Wrap, string> = {
	none: 'Move here',
	left: 'Wrap left',
	right: 'Wrap right',
	block: 'Top and bottom',
};

/** The outline of where a wrapped image lands is never taller than this. */
const MAX_BOX_HEIGHT = 400;

interface Placement {
	target: number;
	plan: MovePlan;
	/** Where the indicator shows the link's line starting, in document coordinates (like lineBlockAt().top). */
	landing: number;
}

export class ImageDrag {
	private readonly doc: Document;
	private readonly win: Window;
	private readonly startDoc: Text;
	private readonly pointer: TrackedPointer;
	/** Listeners that live as long as the drag (the scroller's scroll event). */
	private readonly listeners = new AbortController();
	private readonly link: ImageLink;
	/** The link's line, its index, and the link's columns on it, in the note as it was at the press. */
	private readonly lineText: string;
	private readonly lineIndex: number;
	private readonly column: { from: number; to: number };
	private readonly startX: number;
	private readonly startY: number;

	private dragging = false;
	private quiet = false;
	private x: number;
	private y: number;
	private frame = 0;
	private lines: string[] = [];
	private infos: LineInfo[] = [];
	private targets: number[] = [];
	private zones: boolean[] = [];
	private readonly plans = new Map<string, MovePlan | null>();
	private placement: Placement | null = null;
	private imageSize = { width: 0, height: 0 };
	private ghost: DragGhost | null = null;
	private indicator: DropIndicator | null = null;
	/** The image's own draggable attribute, put back when the press ends. */
	private readonly draggableBefore: string | null;

	constructor(
		private readonly view: EditorView,
		located: LocatedLink,
		private embed: HTMLElement,
		private readonly img: HTMLImageElement,
		start: PointerEvent,
		private readonly onDone: () => void,
	) {
		this.doc = view.dom.ownerDocument;
		this.win = this.doc.defaultView ?? window;
		this.startDoc = view.state.doc;
		this.link = located.link;
		this.lineText = located.line.text;
		this.lineIndex = located.line.number - 1;
		this.column = { from: located.link.from - located.line.from, to: located.link.to - located.line.from };
		this.startX = this.x = start.clientX;
		this.startY = this.y = start.clientY;
		// The browser must not start its own image drag during this press. Cancelling its dragstart (index.ts)
		// is not enough in a pop-out window: Obsidian relays that event to the main window before it gets to
		// the editor, and its drag manager then sets a grabbing cursor that only a dragend would clear. An image
		// that is not draggable never starts one. Put back when the press ends, so Obsidian's own drag (with the
		// setting off, or with a modifier key) and its click are untouched.
		this.draggableBefore = img.getAttribute('draggable');
		img.setAttribute('draggable', 'false');
		this.pointer = trackPointer(this.doc, start, {
			onMove: (event) => this.onMove(event),
			onEnd: (event) => this.onEnd(event),
			onCancel: () => this.onCancel(),
		});
	}

	/** Ends the gesture without writing anything (editor destroyed, plugin unloaded, mode changed). */
	cancel(): void {
		this.quiet = true;
		this.pointer.cancel();
	}

	private onMove(event: PointerEvent): void {
		this.x = event.clientX;
		this.y = event.clientY;
		if (!this.dragging) {
			if (!pastThreshold(this.x - this.startX, this.y - this.startY)) return;
			this.begin();
		}
		this.schedule();
	}

	private begin(): void {
		this.dragging = true;
		this.lines = this.startDoc.toJSON();
		this.infos = scanLines(this.lines);
		this.targets = dropTargets(this.lines, this.infos);
		this.zones = dropZones(this.lines, this.infos);
		const rect = this.img.getBoundingClientRect();
		this.imageSize = { width: rect.width, height: rect.height };
		// Followed on the editor, not the image: the image's widget can be redrawn while the note scrolls.
		this.pointer.capture(this.view.dom);
		this.doc.body.addClass(BODY_CLASS);
		this.embed.addClass(SOURCE_CLASS);
		this.ghost = new DragGhost(this.doc, this.img);
		this.indicator = new DropIndicator(this.doc);
		this.view.scrollDOM.addEventListener('scroll', () => this.schedule(), { passive: true, signal: this.listeners.signal });
	}

	private onEnd(event: PointerEvent): void {
		if (!this.dragging) {
			// A click: Obsidian selects the image, or opens it when it was selected already.
			this.done();
			return;
		}
		this.x = event.clientX;
		this.y = event.clientY;
		let placement: Placement | null = null;
		try {
			this.place();
			placement = this.placement;
		} finally {
			// Whatever happens, the cursor and the overlays are put back.
			swallowNextClick(this.doc, true);
			this.cleanup();
		}
		if (placement) this.commit(placement);
	}

	private onCancel(): void {
		if (this.dragging) {
			if (!this.quiet) swallowNextClick(this.doc, false);
			this.cleanup();
		} else this.done();
	}

	private cleanup(): void {
		if (this.frame) this.win.cancelAnimationFrame(this.frame);
		this.frame = 0;
		this.listeners.abort();
		this.doc.body.removeClass(BODY_CLASS);
		this.embed.removeClass(SOURCE_CLASS);
		this.ghost?.remove();
		this.indicator?.remove();
		this.ghost = this.indicator = null;
		this.placement = null;
		this.done();
	}

	/** Every way a press ends comes through here once. */
	private done(): void {
		if (this.draggableBefore === null) this.img.removeAttribute('draggable');
		else this.img.setAttribute('draggable', this.draggableBefore);
		this.onDone();
	}

	/** One placement (and one auto-scroll step) per animation frame, however many events arrive. */
	private schedule(): void {
		if (!this.frame && this.dragging) this.frame = this.win.requestAnimationFrame(this.onFrame);
	}

	private readonly onFrame = (): void => {
		this.frame = 0;
		if (!this.dragging || this.pointer.finished) return;
		const scroller = this.view.scrollDOM;
		const rect = scroller.getBoundingClientRect();
		const speed = this.inThisPane(rect) ? scrollSpeed(this.y, rect.top, rect.bottom) : 0;
		if (speed !== 0) {
			const before = scroller.scrollTop;
			scroller.scrollTop = before + Math.sign(speed) * Math.max(1, Math.round(Math.abs(speed)));
			// Keep going while the pointer stays in the band and the note can still scroll.
			if (scroller.scrollTop !== before) this.schedule();
		}
		this.place();
	};

	/**
	 * Whether the pointer is over this pane: within the editor's width, and not over another pane (a split
	 * above or below). Beyond the window's edge it still counts, so the note can be scrolled from there.
	 */
	private inThisPane(scroller: DOMRect): boolean {
		if (this.x < scroller.left || this.x > scroller.right) return false;
		const pane = this.doc.elementFromPoint(this.x, this.y)?.closest(PANE);
		return !pane || pane === this.view.dom.closest(PANE);
	}

	/** Top of a line on screen; the line count stands for the end of the note. */
	private lineTop(line: number, documentTop: number): number {
		const doc = this.view.state.doc;
		const top = line < doc.lines ? this.view.lineBlockAt(doc.line(line + 1).from).top : this.view.lineBlockAt(doc.length).bottom;
		return top + documentTop;
	}

	/** Finds the target under the pointer and shows it, or shows nothing when there is none. */
	private place(): void {
		if (!this.ghost || !this.indicator) return;
		this.ghost.move(this.x, this.y);
		this.redimSource();
		const scroller = this.view.scrollDOM.getBoundingClientRect();
		const column = this.view.contentDOM.getBoundingClientRect();
		// Only this pane: over another pane or a sidebar nothing is dropped.
		if (!this.inThisPane(scroller)) return this.clear();
		const documentTop = this.view.documentTop;
		const y = clamp(this.y, scroller.top, scroller.bottom);
		// Over code, a table, a quote, a later list item or frontmatter there is nowhere to drop.
		if (!this.inDropZone(y - documentTop)) return this.clear();
		// The last target is the end of the note when it is the line count (dropTargets).
		const endLast = this.targets[this.targets.length - 1] === this.lines.length;
		const index = nearestTarget(this.targets.length, (i) => this.lineTop(this.targets[i]!, documentTop), y, endLast);
		if (index < 0) return this.clear();
		const target = this.targets[index]!;
		const wrap = this.link.layout.wrap;
		const side = wrap === 'left' || wrap === 'right' ? sideAt(this.x, column.left, column.right) : null;
		const plan = this.plan(target, side);
		// Dropping where the image already is (on the same side) does nothing, so nothing is shown.
		if (!plan || plan.changes.length === 0) return this.clear();

		// Where the link's line will start: under the line before it, after any blank line the move adds there.
		// The view is held there on release (commit), so lines the move takes out above do not shift it.
		const landing = this.lineTop(plan.landing.line, documentTop) + plan.landing.blankLines * this.view.defaultLineHeight;
		this.placement = { target, plan, landing: landing - documentTop };
		const top = clamp(landing, scroller.top, scroller.bottom);
		const bar = { left: column.left, top, width: column.width };
		let box: Rect | null = null;
		if (wrap !== 'none') {
			// Where CSS will draw it: below earlier floats it has to clear, which can be lower than the line.
			const boxTop = clamp(this.landingTop(landing, target, side ?? 'both'), scroller.top, scroller.bottom);
			const width = Math.min(this.imageSize.width, column.width);
			const height = Math.min(this.imageSize.height, MAX_BOX_HEIGHT, Math.max(0, scroller.bottom - boxTop));
			const left =
				side === 'left' ? column.left : side === 'right' ? column.right - width : column.left + (column.width - width) / 2;
			box = { left, top: boxTop, width, height };
		}
		this.indicator.show(bar, box, LABELS[side ?? wrap]);
	}

	/**
	 * The top at which a float inserted before `target` will be drawn. A float never starts above an
	 * earlier float, and a wrapped image clears earlier images on its own side (both sides for top and
	 * bottom), so it lands below those that reach past the line. Only images drawn on screen are seen:
	 * the real ones, and the stand-in copies of those whose own line is not drawn.
	 */
	private landingTop(lineTop: number, target: number, side: Side | 'both'): number {
		const doc = this.view.state.doc;
		const at = target < doc.lines ? doc.line(target + 1).from : doc.length;
		let top = lineTop;
		for (const el of Array.from(this.view.contentDOM.querySelectorAll<HTMLElement>(`${EMBED}, ${STAND_IN_FLOAT}`))) {
			if (el === this.embed) continue; // it leaves its old place
			const pos = this.floatPos(el);
			// Its own stand-in copy (once its line is scrolled away) leaves too.
			if (pos === null || pos === this.link.from || pos >= at) continue;
			const style = el.win.getComputedStyle(el);
			if (style.float !== 'left' && style.float !== 'right') continue;
			const rect = el.getBoundingClientRect();
			top = Math.max(top, rect.top - parseFloat(style.marginTop || '0'));
			if (side === 'both' || style.float === side) top = Math.max(top, rect.bottom + parseFloat(style.marginBottom || '0'));
		}
		return top;
	}

	/** The document position of an image's link: from the editor for a real image, as recorded for a stand-in copy. */
	private floatPos(el: HTMLElement): number | null {
		if (el.matches(STAND_IN_FLOAT)) {
			const pos = Number(el.dataset.from);
			return el.dataset.from && Number.isInteger(pos) ? pos : null;
		}
		try {
			return this.view.posAtDOM(el);
		} catch {
			return null;
		}
	}

	/** Whether the line under a document height is one where the nearest block start may be offered. */
	private inDropZone(height: number): boolean {
		const view = this.view;
		const doc = view.state.doc;
		if (height >= view.lineBlockAt(doc.length).bottom) return true; // below the last line: the end of the note
		const block = view.lineBlockAtHeight(height);
		let line = doc.lineAt(block.from).number - 1;
		// A table, callout or display math drawn as one widget: past its first line the pointer is inside it.
		if (doc.lineAt(block.to).number - 1 > line && height - block.top >= view.defaultLineHeight) line++;
		return this.zones[line] ?? true;
	}

	private clear(): void {
		this.placement = null;
		this.indicator?.hide();
	}

	/** The move to `target`, planned once per target and side. */
	private plan(target: number, side: Side | null): MovePlan | null {
		const key = `${target}:${side ?? ''}`;
		const cached = this.plans.get(key);
		if (cached !== undefined) return cached;
		const { from, to } = this.column;
		const layout = this.link.layout;
		const link =
			side && side !== layout.wrap
				? relayout(this.lineText, { ...this.link, from, to }, { ...layout, wrap: side })
				: this.lineText.slice(from, to);
		const plan = planMove(
			this.lines,
			{ line: this.lineIndex, from, to, target, link, wrapped: layout.wrap !== 'none' },
			this.infos,
			this.targets,
		);
		this.plans.set(key, plan);
		return plan;
	}

	/** Keeps the dragged image dimmed when CodeMirror redraws its widget (scrolled away and back). */
	private redimSource(): void {
		if (this.embed.isConnected || this.view.state.doc !== this.startDoc) return;
		const { from } = this.link;
		const { viewport } = this.view;
		if (from < viewport.from || from > viewport.to) return;
		for (const el of Array.from(this.view.contentDOM.querySelectorAll<HTMLElement>(EMBED))) {
			let pos = -1;
			try {
				pos = this.view.posAtDOM(el);
			} catch {
				continue;
			}
			if (pos === from) {
				this.embed = el;
				el.addClass(SOURCE_CLASS);
				return;
			}
		}
	}

	private commit(placement: Placement): void {
		const view = this.view;
		if (!view.dom.isConnected || view.state.readOnly) return;
		// The targets and the plan were made from the note as it was when the drag started.
		if (view.state.doc !== this.startDoc) {
			new Notice(CHANGED_ELSEWHERE);
			return;
		}
		const { plan, landing } = placement;
		const offset = landing - view.scrollDOM.scrollTop;
		// Undo brings back the view from before the drop (write.ts, keep-scroll.ts).
		dispatchOwn(view, plan.changes, USER_EVENT.move, { undoView: true });
		// The image appears where the indicator was, and stays there while the text it left re-flows, the
		// picture loads and stand-ins update: its line is held at that height. On its own, CodeMirror would keep
		// the line at the top still (or the bottom of the note, when scrolled to the end) and move the image.
		const doc = view.state.doc;
		if (plan.linkLine < doc.lines) keepLineAt(view, doc.line(plan.linkLine + 1).from, offset);
		// A pointer gesture can leave focus on the body; put it back so Undo works at once.
		view.focus();
	}
}
