// The picture toolbar element: one per window, reused for whichever image is selected there.
// Button construction, the pointerdown guard that keeps the editor's focus, and the pressed state read
// from the link follow Image Kit (src/edit-session.ts), MIT, (c) Robert Fleming.
import type { Text } from '@codemirror/state';
import { Menu, setIcon, setTooltip } from 'obsidian';
import { GAPS, type Gap, type Layout, type Wrap } from '../grammar';
import { GAP_LABELS } from '../settings';
import {
	ICON,
	SPACING_DISABLED_LABEL,
	SPACING_LABEL,
	WRAP_CHOICES,
	layoutAfterWrapClick,
	layoutForGap,
} from '../ui/layout-choices';
import { samePlace, type Placement } from '../ui/place-toolbar';

/** The image link the toolbar is showing, as seen when it was last drawn. */
export interface ToolbarSubject {
	/** Document offset where the link starts. */
	from: number;
	layout: Layout;
	/** The note at that moment; a click on a stale toolbar is cancelled. */
	doc: Text;
}

/** The editor that currently shows the toolbar. */
export interface ToolbarHost {
	readonly defaultGap: Gap;
	apply(subject: ToolbarSubject, layout: Layout): void;
	/** Esc while the toolbar has focus. */
	dismiss(): void;
}

const HIDDEN = 'itw-toolbar-hidden';
/** Obsidian 1.14.4: a menu it shows (not a native one) is body > div.menu while it is open. */
const MENU = 'menu';
const ACTIVE = 'is-active';
const DISABLED = 'is-disabled';

export class PictureToolbar {
	readonly el: HTMLElement;
	host: ToolbarHost | null = null;
	private subject: ToolbarSubject | null = null;
	private readonly wrapButtons = new Map<Wrap, HTMLButtonElement>();
	private readonly spacingButton: HTMLButtonElement;
	private spacingTooltip = '';
	private menu: Menu | null = null;
	/** Where the toolbar was last shown, or null while it is hidden. */
	private shownAt: Placement | null = null;
	/** The button (or the toolbar itself) the pointer is over, whose tooltip Obsidian may be showing. */
	private pointed: HTMLElement | null = null;
	/** Watches this window's Obsidian menus come and go (see keyAlreadyUsed). */
	private readonly menus: MutationObserver;
	/** When a menu of this window last closed, on the window's performance.now() clock. */
	private menuClosedAt = -Infinity;

	constructor(readonly doc: Document) {
		this.el = doc.body.createDiv({
			cls: ['itw-toolbar', HIDDEN],
			attr: { role: 'toolbar', 'aria-label': 'Picture layout' },
		});
		for (const choice of WRAP_CHOICES) {
			const button = this.addButton(choice.icon, choice.label);
			button.setAttribute('aria-pressed', 'false');
			button.addEventListener('click', () => this.chooseWrap(choice.wrap));
			this.wrapButtons.set(choice.wrap, button);
		}
		this.el.createDiv({ cls: 'itw-toolbar-separator', attr: { 'aria-hidden': 'true' } });
		this.spacingButton = this.addButton(ICON.spacing, SPACING_LABEL);
		this.spacingButton.setAttribute('aria-haspopup', 'menu');
		this.spacingButton.setAttribute('aria-expanded', 'false');
		this.spacingButton.addEventListener('click', () => this.toggleSpacingMenu());

		// A press on the toolbar must not take focus from the editor, or Obsidian's image selection with it.
		const keepFocus = (e: Event) => e.preventDefault();
		this.el.addEventListener('pointerdown', keepFocus);
		this.el.addEventListener('mousedown', keepFocus);
		this.el.addEventListener('keydown', (e) => {
			if (e.key === 'Escape' && !this.keyAlreadyUsed(e)) this.host?.dismiss();
		});
		const buttons = [...this.wrapButtons.values(), this.spacingButton];
		this.el.addEventListener('pointerover', (e) => {
			this.pointed = buttons.find((b) => b.contains(e.target as Node | null)) ?? this.el;
		});
		this.el.addEventListener('pointerleave', () => {
			this.pointed = null;
		});

		// Obsidian puts every menu it shows (the Spacing dropdown, an image's right-click menu) straight in
		// the window's body and takes it out when it closes. The window's own observer, for pop-out windows.
		const win = doc.win as Window & { MutationObserver?: typeof MutationObserver };
		this.menus = new (win.MutationObserver ?? MutationObserver)((records) => {
			const closed = records.some((r) => Array.from(r.removedNodes).some((n) => n.instanceOf(HTMLElement) && n.hasClass(MENU)));
			if (closed) this.menuClosedAt = win.performance.now();
		});
		this.menus.observe(doc.body, { childList: true });
	}

	/**
	 * True when this key press has already been used, for instance to close a menu. Esc closes the innermost
	 * thing open, one per press (like Word's Layout Options): the press that closes the Spacing dropdown or
	 * the image's right-click menu leaves the toolbar shown, and the next one hides it.
	 *
	 * Obsidian closes an open menu on Esc before the key reaches the editor (its key handling listens on the
	 * window, first), and lets the key go on without marking it. The removal is noted by the observer above,
	 * whose callback runs as soon as Obsidian's listener returns, before the editor's listeners. An event's
	 * timeStamp and performance.now() share the window's clock, so a menu closed after the key was pressed
	 * was closed by it.
	 */
	keyAlreadyUsed(e: KeyboardEvent): boolean {
		return e.defaultPrevented || this.menuClosedAt >= e.timeStamp;
	}

	private addButton(icon: string, label: string): HTMLButtonElement {
		const button = this.el.createEl('button', {
			cls: ['clickable-icon', 'itw-toolbar-button'],
			attr: { type: 'button' },
		});
		setIcon(button, icon);
		setTooltip(button, label);
		return button;
	}

	get isShown(): boolean {
		return !this.el.hasClass(HIDDEN);
	}

	/** Pressed state and the Spacing button, from the link itself. */
	render(subject: ToolbarSubject): void {
		this.subject = subject;
		const { wrap, gap } = subject.layout;
		for (const [choice, button] of this.wrapButtons) {
			const on = choice === wrap;
			button.toggleClass(ACTIVE, on);
			button.setAttribute('aria-pressed', String(on));
		}
		const off = wrap === 'none';
		this.spacingButton.toggleClass(DISABLED, off);
		this.spacingButton.setAttribute('aria-disabled', String(off));
		const tooltip = off ? SPACING_DISABLED_LABEL : `${SPACING_LABEL}: ${GAP_LABELS[gap]}`;
		if (tooltip !== this.spacingTooltip) {
			setTooltip(this.spacingButton, tooltip);
			this.spacingTooltip = tooltip;
		}
		if (off) this.menu?.hide();
	}

	showAt(placement: Placement): void {
		// The Spacing dropdown is placed once, under its button: when the toolbar moves (the note scrolled,
		// the window was resized, the text reflowed), it closes rather than stay behind.
		if (this.shownAt && !samePlace(this.shownAt, placement)) this.menu?.hide();
		this.shownAt = placement;
		this.el.setCssStyles({ left: `${placement.left}px`, top: `${placement.top}px` });
		this.el.dataset.placement = placement.where;
		this.el.removeClass(HIDDEN);
	}

	hide(): void {
		this.menu?.hide();
		this.endHover();
		this.el.addClass(HIDDEN);
		this.subject = null;
		this.shownAt = null;
	}

	destroy(): void {
		this.menu?.hide();
		this.endHover();
		this.menus.disconnect();
		this.el.remove();
		this.host = null;
	}

	/**
	 * Obsidian hides a button's tooltip when the pointer leaves the button. Hiding the toolbar under a still
	 * pointer (Esc) sends no such event, so the tooltip would stay until the mouse moves: tell Obsidian's
	 * tooltip the pointer left, with the toolbar window's own event type so pop-out windows work too.
	 */
	private endHover(): void {
		const pointed = this.pointed;
		const win = this.doc.defaultView;
		this.pointed = null;
		if (!pointed || !win) return;
		pointed.dispatchEvent(new win.PointerEvent('pointerout', { bubbles: true, pointerType: 'mouse' }));
	}

	private chooseWrap(wrap: Wrap): void {
		const { host, subject } = this;
		if (!host || !subject) return;
		host.apply(subject, layoutAfterWrapClick(subject.layout, wrap, host.defaultGap));
	}

	private toggleSpacingMenu(): void {
		if (this.menu) {
			this.menu.hide();
			return;
		}
		const subject = this.subject;
		if (!this.host || !subject || subject.layout.wrap === 'none') return;
		const menu = new Menu();
		// A small dropdown under the button, like Word's; also keeps it in this window's DOM.
		menu.setUseNativeMenu(false);
		for (const gap of GAPS) {
			menu.addItem((item) =>
				item
					.setTitle(GAP_LABELS[gap])
					.setChecked(gap === subject.layout.gap)
					.onClick(() => {
						// The note as it was when the menu opened: if it changed meanwhile, the write is cancelled.
						const next = layoutForGap(subject.layout, gap);
						if (next) this.host?.apply(subject, next);
					}),
			);
		}
		menu.onHide(() => {
			if (this.menu === menu) this.menu = null;
			this.spacingButton.setAttribute('aria-expanded', 'false');
			this.spacingButton.removeClass('has-active-menu');
		});
		this.menu = menu;
		this.spacingButton.setAttribute('aria-expanded', 'true');
		this.spacingButton.addClass('has-active-menu');
		const r = this.spacingButton.getBoundingClientRect();
		menu.showAtPosition({ x: r.left, y: r.bottom + 4 }, this.doc);
	}
}
