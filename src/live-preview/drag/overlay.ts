// What the user sees while dragging: a translucent copy of the image under the pointer, and a marker
// where it will land. Both are fixed-position elements on the window's body that never take the pointer,
// positioned through CSS variables (styles.css, section "Drag").
//
// The shape (a body-level ghost and a line-or-box indicator moved with setCssProps) follows Adjustable
// Media (src/view/dragGhost.ts, src/view/blockDrag.ts createDropIndicator), MIT, (c) 2026 Yi-luo-hua.
import { fitWithin } from './geometry';

/** The ghost is never bigger than this, so it does not hide the note. */
const GHOST_MAX = 240;
/** Offset from the pointer, so the ghost never covers the point being dropped on. */
const GHOST_OFFSET = 16;

export class DragGhost {
	private readonly el: HTMLElement;

	constructor(doc: Document, img: HTMLImageElement) {
		const rect = img.getBoundingClientRect();
		const size = fitWithin(rect.width || img.naturalWidth, rect.height || img.naturalHeight, GHOST_MAX, GHOST_MAX);
		this.el = doc.body.createDiv({ cls: 'itw-drag-ghost' });
		this.el.createEl('img', { attr: { src: img.currentSrc || img.src, alt: '', draggable: 'false' } });
		this.el.setCssProps({ '--itw-ghost-width': `${size.width}px`, '--itw-ghost-height': `${size.height}px` });
	}

	move(x: number, y: number): void {
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
