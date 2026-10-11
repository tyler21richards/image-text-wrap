// Phone and tablet: the part of the note a drag can aim at and scroll from. The note's scroller can reach
// under bars that Obsidian and the system draw over it; a drop indicator there could not be seen, and a
// finger there could not reach the auto-scroll band.
//
// Obsidian's DOM on mobile, checked on 1.14.4 in its mobile emulation (app.emulateMobile) on 2026-10-11, at
// 390x844 (phone) and 1024x768 (tablet):
//
//   phone:   the editor's .cm-scroller fills the whole window (0-844). Drawn over it:
//              the leaf's .view-header (position: fixed, 59-104), below the status bar;
//              .mobile-navbar (fixed, floating at 760-812);
//            both slide out of the window (a translateY transform, opacity 0) while the note scrolls down
//            (body.is-hidden-nav), and come back when it scrolls up.
//            While the note is edited (body.mod-toolbar-open) the navbar is taken out of the page and
//            .mobile-toolbar (above the keyboard, 792-836) is shown; the scroller then ends above it.
//   tablet:  the leaf's .view-header sits above the scroller (151-768), and there is no navbar.
//   both:    body's --safe-area-inset-top and --safe-area-inset-bottom (59 px and 34 px in the emulation)
//            are the system's status bar and home indicator, which the note shows through.
//   The emulation has no on-screen keyboard. On a device, window.visualViewport is the part of the window
//   the keyboard leaves visible.
import type { EditorView } from '@codemirror/view';
import { PANE } from '../../dom';
import { visibleBand, type Band, type Box } from './geometry';

/** Bars Obsidian floats over the note on a phone: the navigation bar, and the editing toolbar above the keyboard. */
const FLOATING_BARS = '.mobile-navbar, .mobile-toolbar';
/** The bar with the note's title and buttons, at the top of its pane; on a phone it floats over the note. */
const VIEW_HEADER = '.view-header';

/** The part of the editor's scroller that can be seen, top to bottom, in client pixels. */
export function visibleScroller(view: EditorView): Band {
	const doc = view.dom.ownerDocument;
	const win = doc.defaultView ?? window;
	const scroller = view.scrollDOM.getBoundingClientRect();
	const body = win.getComputedStyle(doc.body);
	const inset = (name: string) => parseFloat(body.getPropertyValue(name)) || 0;
	const vv = win.visualViewport;
	const top = vv ? vv.offsetTop : 0;
	const bottom = vv ? vv.offsetTop + vv.height : win.innerHeight;
	const viewport = { top: top + inset('--safe-area-inset-top'), bottom: bottom - inset('--safe-area-inset-bottom') };
	const bars = [view.dom.closest(PANE)?.querySelector(VIEW_HEADER), ...Array.from(doc.querySelectorAll(FLOATING_BARS))];
	const covers: Box[] = [];
	for (const bar of bars) if (bar) covers.push(shownAt(bar, win));
	return visibleBand(scroller, viewport, covers);
}

/**
 * Where a bar is when it is shown. The bars that slide away while the note scrolls down come back when it scrolls
 * up, and a drag scrolls both ways: the band stays where they are shown, rather than jumping as they slide (which
 * would also move the auto-scroll band from under a finger that is still).
 */
function shownAt(bar: Element, win: Window): Box {
	const rect = bar.getBoundingClientRect();
	const transform = win.getComputedStyle(bar).transform;
	const slid = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform).m42 : 0;
	return { left: rect.left, right: rect.right, top: rect.top - slid, bottom: rect.bottom - slid };
}
