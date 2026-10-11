// What the user sees while dragging: a translucent copy of the image under the pointer, and a marker
// where it will land. Both are fixed-position elements on the window's body that never take the pointer,
// positioned through CSS variables (styles.css, section "Drag").
//
// The shape (a body-level ghost and a line-or-box indicator moved with setCssProps) follows Adjustable
// Media (src/view/dragGhost.ts, src/view/blockDrag.ts createDropIndicator), MIT, (c) 2026 Yi-luo-hua.
import { fitWithin, ghostByFinger } from './geometry';

/** The ghost is never bigger than this, so it does not hide the note. */
const GHOST_MAX = 240;
/** Offset from the pointer, so the ghost never covers the point being dropped on. */
const GHOST_OFFSET = 16;
/** Under a finger the ghost is smaller: it is drawn above the finger, over the part of the note being aimed at. */
const FINGER_GHOST_MAX = 140;
/** How long the ring shown as a finger picks an image up lasts (styles.css), in milliseconds. */
const PICK_UP_MS = 300;

export class DragGhost {
	private readonly el: HTMLElement;
	private readonly win: Window;
	private readonly size: { width: number; height: number };

	/** With `finger`, the ghost goes above the point instead of beside it, so the finger does not hide it. */
	constructor(
		doc: Document,
		img: HTMLImageElement,
		private readonly finger = false,
	) {
		const rect = img.getBoundingClientRect();
		const max = finger ? FINGER_GHOST_MAX : GHOST_MAX;
		const size = (this.size = fitWithin(rect.width || img.naturalWidth, rect.height || img.naturalHeight, max, max));
		this.win = doc.defaultView ?? window;
		this.el = doc.body.createDiv({ cls: 'itw-drag-ghost' });
		this.el.createEl('img', { attr: { src: img.currentSrc || img.src, alt: '', draggable: 'false' } });
		this.el.setCssProps({ '--itw-ghost-width': `${size.width}px`, '--itw-ghost-height': `${size.height}px` });
	}

	move(x: number, y: number): void {
		if (this.finger) {
			const { width, height } = this.size;
			const at = ghostByFinger(x, y, width, height, { width: this.win.innerWidth, height: this.win.innerHeight });
			this.el.setCssProps({ '--itw-ghost-x': `${at.left}px`, '--itw-ghost-y': `${at.top}px` });
			return;
		}
		this.el.setCssProps({ '--itw-ghost-x': `${x + GHOST_OFFSET}px`, '--itw-ghost-y': `${y + GHOST_OFFSET}px` });
	}

	remove(): void {
		this.el.remove();
	}
}

export interface Rect {
	left: number;
	top: number;
	width: number;
	height: number;
}

export class DropIndicator {
	private readonly bar: HTMLElement;
	private readonly box: HTMLElement;
	private readonly label: HTMLElement;

	constructor(doc: Document) {
		this.bar = doc.body.createDiv({ cls: 'itw-drop-bar is-hidden' });
		this.box = doc.body.createDiv({ cls: 'itw-drop-box is-hidden' });
		this.label = doc.body.createDiv({ cls: 'itw-drop-label is-hidden' });
	}

	/**
	 * A bar across the column at `bar`, and when `box` is given, a dashed outline where the image will sit.
	 * The label goes inside the box, or just above the bar when there is no box.
	 */
	show(bar: { left: number; top: number; width: number }, box: Rect | null, text: string): void {
		this.bar.removeClass('is-hidden');
		this.bar.setCssProps({ '--itw-drop-x': `${bar.left}px`, '--itw-drop-y': `${bar.top}px`, '--itw-drop-width': `${bar.width}px` });
		this.box.toggleClass('is-hidden', !box);
		if (box) {
			this.box.setCssProps({
				'--itw-drop-x': `${box.left}px`,
				'--itw-drop-y': `${box.top}px`,
				'--itw-drop-width': `${box.width}px`,
				'--itw-drop-height': `${box.height}px`,
			});
		}
		this.label.removeClass('is-hidden');
		this.label.setText(text);
		this.label.toggleClass('is-in-box', !!box);
		const at = box ?? { left: bar.left, top: bar.top };
		this.label.setCssProps({ '--itw-drop-x': `${at.left}px`, '--itw-drop-y': `${at.top}px` });
	}

	hide(): void {
		this.bar.addClass('is-hidden');
		this.box.addClass('is-hidden');
		this.label.addClass('is-hidden');
	}

	get visible(): boolean {
		return !this.bar.hasClass('is-hidden');
	}

	remove(): void {
		this.bar.remove();
		this.box.remove();
		this.label.remove();
	}
}

/**
 * A ring that spreads from the finger as it picks an image up, like the one Obsidian's own long-press drags
 * show on mobile. It removes itself.
 */
export function showPickUp(doc: Document, x: number, y: number): void {
	const el = doc.body.createDiv({ cls: 'itw-pick-up' });
	el.setCssProps({ '--itw-pick-up-x': `${x}px`, '--itw-pick-up-y': `${y}px` });
	// Laid out small first, so that the class below makes it spread (a CSS transition, styles.css).
	el.getBoundingClientRect();
	el.addClass('is-spreading');
	(doc.defaultView ?? window).setTimeout(() => el.remove(), PICK_UP_MS + 50);
}
