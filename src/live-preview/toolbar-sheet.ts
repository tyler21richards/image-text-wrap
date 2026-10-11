// The picture toolbar on phones and tablets (brief milestone M5): a sheet docked at the bottom of the
// screen, with the four layouts as large buttons that carry a visible label (touch has no hover, so no
// tooltip can explain an icon) and the spacing as a row of segments. One per window, reused for whichever
// image is selected there; the editor showing it (toolbar.ts) decides where it goes.
//
// Obsidian's mobile layout, checked in its mobile emulation on 1.14.4 (phone 390 x 844, tablet 1024 x 768):
//   body.is-mobile, with .is-phone or .is-tablet
//   navigation bar: .app-container > .mobile-navbar, fixed at the bottom; on phones a floating pill above
//     the safe area (.is-floating-nav), on tablets display: none. Scrolling down a note with "auto full
//     screen" gives body .is-hidden-nav, and the bar slides down (a transform) and fades out
//   editing toolbar: .app-container > .mobile-toolbar while the editor has focus (Android: and the keyboard
//     is open), with body.mod-toolbar-open; the navigation bar is taken out of the page meanwhile. Its top is
//     calc(100vh - var(--keyboard-height) - var(--mobile-toolbar-height)), and it slides (a transform) as the
//     keyboard moves
//   keyboard: :root --keyboard-height, set by the app; the safe area: --safe-area-inset-bottom, -left, -right
//   view header: .workspace-leaf-content > .view-header, fixed over the top of the note on phones. With "auto
//     full screen" (body.auto-full-screen, on by default) it slides up out of the screen (a transform) as soon
//     as the note scrolls down, and comes back as it scrolls up or at the next press anywhere (mousedown); not
//     while the keyboard is up. Phones are any window under 600 px wide or tall, so also a phone in landscape
//   top safe area: --safe-area-inset-top on body; the emulation keeps the portrait value (59 px) in landscape
//   sidebars: .workspace-drawer, z-index 30, over a backdrop at var(--layer-cover). On phones opening one
//     slides the whole note aside (a transform, which resizes nothing and fires no workspace event); on
//     tablets it floats over the note, which stays put
//   a tap on a Live Preview image selects it (.is-selected) as a click does on desktop, and focuses the
//     embed itself (tabindex -1), not the text, so no keyboard opens; there is no resize corner, only
//     .embed-actions > .edit-block-button
//   the Android Back button: Obsidian closes its own menus, dialogs and sidebars, or else goes back in
//     the note's history. Plugins have no way to take part, so Back hides the sheet only by leaving the note
//   a long press on iPhone and iPad: WebKit sends no contextmenu; Obsidian's app sends one of its own
//     (untrusted, cancelable) after 0.8 s without moving, and buzzes (navigator.vibrate(200)) when a listener
//     cancels it, as if a menu had opened. On Android the browser's own (trusted) contextmenu comes instead
//   a double tap: both taps arrive as clicks, with no delay (the app turns double-tap zoom off). A second tap
//     on a selected picture opens Obsidian's image viewer
import { setIcon } from 'obsidian';
import { isElement } from '../dom';
import type { Gap, Wrap } from '../grammar';
import {
	SHEET_LABEL,
	SPACING_CHOICES,
	SPACING_HINT,
	SPACING_LABEL,
	WRAP_CHOICES,
	layoutAfterWrapClick,
	layoutForGap,
} from '../ui/layout-choices';
import type { SheetHeader, SheetScreen } from '../ui/place-toolbar';
import { ACTIVE, DISABLED, MenuWatch, type LayoutPanel, type ToolbarHost, type ToolbarSubject } from './toolbar-dom';

/** The bars Obsidian docks at the bottom of the screen: the navigation bar and the editing toolbar. */
const BOTTOM_BARS = '.mobile-navbar, .mobile-toolbar';
const LEAF = '.workspace-leaf-content';
const VIEW_HEADER = '.view-header';
const KEYBOARD_HEIGHT = '--keyboard-height';
const SAFE_AREA_BOTTOM = '--safe-area-inset-bottom';
const SAFE_AREA_TOP = '--safe-area-inset-top';
/** Body classes: a phone-sized window, and Obsidian's "auto full screen" setting. */
const PHONE = 'is-phone';
const AUTO_FULL_SCREEN = 'auto-full-screen';

const HIDDEN = 'itw-sheet-hidden';
/** Just shown: taps go through the sheet for a moment (styles.css). */
const ARMING = 'itw-sheet-arming';
const HINT_ID = 'itw-sheet-spacing-hint';

/**
 * How long after a tap the second tap of a double tap may still come, in milliseconds (Android counts 300 ms
 * between the taps; a little more covers the frame the sheet takes to appear). Until then a sheet that has
 * just appeared lets taps through, and the note does not scroll the picture away (toolbar.ts), so the second
 * tap reaches the picture it was meant for.
 */
export const DOUBLE_TAP_WAIT = 350;

export class PictureSheet implements LayoutPanel {
	readonly el: HTMLElement;
	host: ToolbarHost | null = null;
	private subject: ToolbarSubject | null = null;
	private readonly wrapButtons = new Map<Wrap, HTMLButtonElement>();
	private readonly gapButtons = new Map<Gap, HTMLButtonElement>();
	private readonly spacing: HTMLElement;
	private readonly hint: HTMLElement;
	private readonly menus: MenuWatch;
	/** The timer that ends the moment after the sheet appears in which taps go through it; 0 when none runs. */
	private arming = 0;

	constructor(readonly doc: Document) {
		this.el = doc.body.createDiv({
			cls: ['itw-sheet', HIDDEN],
			attr: { role: 'toolbar', 'aria-label': SHEET_LABEL },
		});
		const choices = this.el.createDiv({ cls: 'itw-sheet-choices' });
		for (const choice of WRAP_CHOICES) {
			const button = choices.createEl('button', {
				cls: 'itw-sheet-choice',
				attr: { type: 'button', 'aria-pressed': 'false' },
			});
			setIcon(button.createSpan({ cls: 'itw-sheet-choice-icon' }), choice.icon);
			button.createSpan({ cls: 'itw-sheet-choice-label', text: choice.short });
			button.addEventListener('click', () => this.chooseWrap(choice.wrap));
			this.wrapButtons.set(choice.wrap, button);
		}

		const section = this.el.createDiv({ cls: 'itw-sheet-spacing-section' });
		const header = section.createDiv({ cls: 'itw-sheet-spacing-header' });
		header.createSpan({ cls: 'itw-sheet-spacing-title', text: SPACING_LABEL });
		this.hint = header.createSpan({ cls: 'itw-sheet-spacing-hint', text: SPACING_HINT, attr: { id: HINT_ID } });
		this.spacing = section.createDiv({ cls: 'itw-sheet-spacing', attr: { role: 'group', 'aria-label': SPACING_LABEL } });
		for (const { gap, label } of SPACING_CHOICES) {
			const button = this.spacing.createEl('button', {
				cls: 'itw-sheet-segment',
				text: label,
				attr: { type: 'button', 'aria-pressed': 'false' },
			});
			button.addEventListener('click', () => this.chooseGap(gap));
			this.gapButtons.set(gap, button);
		}

		// A tap on the sheet must not take focus (which on a phone would close or open the keyboard), move the
		// cursor or end Obsidian's image selection: no default action for the press, as on the desktop toolbar.
		const keepFocus = (e: Event) => e.preventDefault();
		this.el.addEventListener('pointerdown', keepFocus);
		this.el.addEventListener('mousedown', keepFocus);
		// A long press on the sheet is not a right-click on anything: no menu for it, from the browser (Android:
		// cancelled) or from anything above the sheet (stopped here). Obsidian's own contextmenu on iPhone and
		// iPad is untrusted, has no browser menu behind it, and buzzes when cancelled, so that one is only
		// stopped. The same rule as the drag's (keepMenuShut in drag/pointer.ts).
		this.el.addEventListener('contextmenu', (e) => {
			if (e.isTrusted) e.preventDefault();
			e.stopPropagation();
		});
		this.menus = new MenuWatch(doc);
	}

	keyAlreadyUsed(e: KeyboardEvent): boolean {
		return this.menus.keyAlreadyUsed(e);
	}

	/** Pressed state, and whether spacing is offered, from the link itself. */
	render(subject: ToolbarSubject): void {
		this.subject = subject;
		const { wrap, gap } = subject.layout;
		for (const [choice, button] of this.wrapButtons) {
			const on = choice === wrap;
			button.toggleClass(ACTIVE, on);
			button.setAttribute('aria-pressed', String(on));
		}
		const off = wrap === 'none';
		for (const [choice, button] of this.gapButtons) {
			const on = !off && choice === gap;
			button.toggleClass(ACTIVE, on);
			button.setAttribute('aria-pressed', String(on));
			button.toggleClass(DISABLED, off);
			button.setAttribute('aria-disabled', String(off));
		}
		this.spacing.toggleClass(DISABLED, off);
		this.hint.toggleClass('itw-sheet-hint-hidden', !off);
		if (off) this.spacing.setAttribute('aria-describedby', HINT_ID);
		else this.spacing.removeAttribute('aria-describedby');
	}

	/**
	 * Shows the sheet with its bottom edge `bottom` px above the bottom of the window. A sheet that appears lets
	 * taps through it for DOUBLE_TAP_WAIT ms: it appears a frame after the tap that selected a picture, often
	 * where that picture is, and the second tap of a double tap must not press the button that is now under
	 * the finger (pressing the current layout turns wrapping off). It reaches the picture instead, and Obsidian
	 * opens its viewer, as for a picture higher up.
	 */
	showAt(bottom: number): void {
		this.el.setCssProps({ '--itw-sheet-bottom': `${bottom}px` });
		if (!this.el.hasClass(HIDDEN)) return;
		this.el.removeClass(HIDDEN);
		this.stopArming();
		this.el.addClass(ARMING);
		this.arming = this.doc.win.setTimeout(() => {
			this.arming = 0;
			this.el.removeClass(ARMING);
		}, DOUBLE_TAP_WAIT);
	}

	hide(): void {
		this.stopArming();
		this.el.addClass(HIDDEN);
		this.subject = null;
	}

	destroy(): void {
		this.stopArming();
		this.menus.disconnect();
		this.el.remove();
		this.host = null;
	}

	private stopArming(): void {
		if (this.arming) this.doc.win.clearTimeout(this.arming);
		this.arming = 0;
		this.el.removeClass(ARMING);
	}

	private chooseWrap(wrap: Wrap): void {
		const { host, subject } = this;
		if (!host || !subject) return;
		host.apply(subject, layoutAfterWrapClick(subject.layout, wrap, host.defaultGap));
	}

	private chooseGap(gap: Gap): void {
		const { host, subject } = this;
		if (!host || !subject) return;
		// Null while the picture is in line (spacing does not apply) or when it already has this spacing.
		const next = layoutForGap(subject.layout, gap);
		if (next) host.apply(subject, next);
	}
}

/** A length custom property of `el` in px (0 when unset or not a length). */
function cssPx(el: HTMLElement, name: string): number {
	const value = parseFloat(el.win.getComputedStyle(el).getPropertyValue(name));
	return Number.isFinite(value) ? value : 0;
}

/** How far an element's own transform moves it down (a slide under way or done); 0 without one. */
function slide(el: HTMLElement): number {
	const transform = el.win.getComputedStyle(el).transform;
	if (!transform || transform === 'none') return 0;
	const Matrix = (el.win as Window & { DOMMatrix?: typeof DOMMatrix }).DOMMatrix ?? DOMMatrix;
	return new Matrix(transform).m42;
}

/**
 * Where a bar's top rests, leaving out a slide of its own (a transform) that may be under way: the
 * editing toolbar slides after the keyboard, and the navigation bar slides away while the note scrolls
 * down and back as it scrolls up. Keeping clear of the resting place keeps the sheet still meanwhile.
 * Null when the bar is not shown at all.
 */
function restingTop(el: HTMLElement): number | null {
	const r = el.getBoundingClientRect();
	if (r.width === 0 || r.height === 0) return null;
	return r.top - slide(el);
}

/** What sits at the bottom of the screen of `doc`'s window (measure phase only). */
export function measureScreen(doc: Document, gap: number): SheetScreen {
	const win = doc.win;
	const bars: number[] = [];
	for (const el of Array.from(doc.querySelectorAll<HTMLElement>(BOTTOM_BARS))) {
		const top = restingTop(el);
		if (top !== null) bars.push(top);
	}
	const vv = win.visualViewport;
	return {
		height: win.innerHeight,
		// A zoomed page has a smaller visual viewport too; only an unzoomed one tells where a keyboard starts.
		visual: vv && Math.abs(vv.scale - 1) < 0.01 ? { top: vv.offsetTop, height: vv.height } : null,
		keyboard: cssPx(doc.documentElement, KEYBOARD_HEIGHT),
		safeBottom: cssPx(doc.body, SAFE_AREA_BOTTOM),
		safeTop: cssPx(doc.body, SAFE_AREA_TOP),
		bars,
		gap,
	};
}

/**
 * The header bar of the note in `scroller`, which lies over the top of the note on phones (measure phase
 * only). `keyboard`: whether a keyboard is up, which keeps Obsidian from sliding the header away.
 */
export function measureHeader(scroller: HTMLElement, keyboard: boolean): SheetHeader {
	const header = scroller.closest(LEAF)?.querySelector<HTMLElement>(VIEW_HEADER);
	const r = header?.getBoundingClientRect();
	if (!header || !r || r.height === 0) return { bottom: -Infinity, restingBottom: -Infinity, hidesOnScroll: false };
	const body = scroller.doc.body;
	return {
		bottom: r.bottom,
		restingBottom: r.bottom - slide(header),
		hidesOnScroll: !keyboard && body.hasClass(PHONE) && body.hasClass(AUTO_FULL_SCREEN),
	};
}

export interface ScreenEvents {
	/** Something that decides where the sheet goes, or whether the note is on screen, may have changed. */
	changed: () => void;
	/** A key was pressed anywhere in the window. */
	keydown: (e: KeyboardEvent) => void;
	/** A tap (a click, which a scroll never makes) on the note. */
	tapped: () => void;
}

/**
 * Watches one editor's window for what moves the sheet or the note on a phone or tablet: the window or its
 * visual viewport resizing (rotation, a keyboard), Obsidian's keyboard height and body classes (the editing
 * toolbar, the navigation bar hiding), the bars' transitions ending, and the note sliding aside for a
 * sidebar (an IntersectionObserver: a slide is a transform, which no resize or workspace event reports).
 * Also passes on key presses anywhere in the window (with a hardware keyboard the focus need not be in the
 * editor for Esc) and taps on the note. Owned by the editor's ViewPlugin (toolbar.ts), which calls destroy().
 */
export class ScreenWatch {
	private readonly win: Window;
	private readonly styles: MutationObserver;
	private readonly onScreen: IntersectionObserver;

	constructor(
		private readonly scroller: HTMLElement,
		private readonly events: ScreenEvents,
	) {
		const win = (this.win = scroller.win);
		win.addEventListener('resize', events.changed);
		win.visualViewport?.addEventListener('resize', events.changed);
		win.visualViewport?.addEventListener('scroll', events.changed);
		win.addEventListener('keydown', events.keydown);
		win.addEventListener('transitionend', this.onTransitionEnd, true);
		scroller.addEventListener('click', events.tapped, true);
		const own = win as Window & { MutationObserver?: typeof MutationObserver; IntersectionObserver?: typeof IntersectionObserver };
		this.styles = new (own.MutationObserver ?? MutationObserver)(() => events.changed());
		this.styles.observe(scroller.doc.body, { attributes: true, attributeFilter: ['class'] });
		this.styles.observe(scroller.doc.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
		this.onScreen = new (own.IntersectionObserver ?? IntersectionObserver)(() => events.changed(), {
			threshold: [0, 0.25, 0.5, 0.75, 1],
		});
		this.onScreen.observe(scroller);
	}

	/**
	 * The navigation bar moves with a transition of its margin as the keyboard comes and goes (measured: the
	 * sheet was placed while the bar was still below the screen, and then covered it).
	 */
	private readonly onTransitionEnd = (e: TransitionEvent): void => {
		if (isElement(e.target) && e.target.matches(BOTTOM_BARS)) this.events.changed();
	};

	destroy(): void {
		const { win, events } = this;
		win.removeEventListener('resize', events.changed);
		win.visualViewport?.removeEventListener('resize', events.changed);
		win.visualViewport?.removeEventListener('scroll', events.changed);
		win.removeEventListener('keydown', events.keydown);
		win.removeEventListener('transitionend', this.onTransitionEnd, true);
		this.scroller.removeEventListener('click', events.tapped, true);
		this.styles.disconnect();
		this.onScreen.disconnect();
	}
}
