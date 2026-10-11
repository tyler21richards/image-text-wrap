// Follows one pointer gesture from press to release.
//
// Adapted from Adjustable Media (src/view/pointer.ts, trackPointer), MIT, (c) 2026 Yi-luo-hua. Changes:
// every listener hangs on one AbortController, so the gesture can be cancelled from outside (editor
// destroyed, plugin unloaded); and the pointer is captured only when the caller asks (once the press has
// become a drag), because capturing at the press would retarget the click that selects the image.
//
// A finger (a touch, or a pen on a phone or tablet) is followed the same way, with what a long press needs on top
// (TouchHold).

export interface PointerHandlers {
	onMove(event: PointerEvent): void;
	onEnd(event: PointerEvent): void;
	/**
	 * The gesture was interrupted (Escape, pointercancel, lost capture, a missed release, a native drag, and for a
	 * finger a second finger or the app going to the background). `gone`: the pointer itself was cancelled
	 * (pointercancel), so no release and no click will follow.
	 */
	onCancel(gone: boolean): void;
}

/**
 * For a finger: while it rests on the image the browser may still scroll the note (the press is then a swipe);
 * once the image is picked up (`holding`), it must not.
 */
export interface TouchHold {
	/** Whether the finger holds the image now. */
	holding(): boolean;
	/** The browser recognised a long press (it asked for its menu, as Android does): pick the image up now. */
	onLongPress(): void;
}

export interface TrackedPointer {
	/** Sends the rest of the gesture to `el`, so it is followed even outside the window. */
	capture(el: HTMLElement): void;
	/** Ends the gesture now, as a cancel. Safe to call more than once. */
	cancel(): void;
	readonly finished: boolean;
}

/**
 * Starts following the gesture that `start` began, on `doc` (the image's own document, for pop-out
 * windows). It ends exactly once, through onEnd or onCancel, after every listener is removed. No text
 * is selected while it lasts: in Live Preview a selection reaching the link would show its source in
 * place of the image.
 */
export function trackPointer(doc: Document, start: PointerEvent, handlers: PointerHandlers, touch?: TouchHold): TrackedPointer {
	const controller = new AbortController();
	const { signal } = controller;
	let finished = false;
	let holder: HTMLElement | null = null;

	const finish = (ended: PointerEvent | null, gone = false): void => {
		if (finished) return;
		finished = true;
		controller.abort();
		try {
			if (holder?.hasPointerCapture(start.pointerId)) holder.releasePointerCapture(start.pointerId);
		} catch {
			/* the pointer is gone already */
		}
		if (ended) handlers.onEnd(ended);
		else handlers.onCancel(gone);
	};

	const onMove = (event: PointerEvent): void => {
		if (event.pointerId !== start.pointerId) return;
		// A mouse moving with no button held was released without us hearing it.
		if (event.pointerType === 'mouse' && event.buttons === 0) {
			finish(null);
			return;
		}
		handlers.onMove(event);
	};
	const onUp = (event: PointerEvent): void => {
		if (event.pointerId === start.pointerId) finish(event);
	};
	const onCancel = (event: PointerEvent): void => {
		if (event.pointerId === start.pointerId) finish(null, true);
	};
	// Losing the capture leaves the pointer down (the editor was taken out of the page): its release still comes.
	const onLost = (event: PointerEvent): void => {
		if (event.pointerId === start.pointerId) finish(null);
	};
	const onKey = (event: KeyboardEvent): void => {
		if (event.key !== 'Escape') return;
		event.preventDefault();
		event.stopPropagation();
		finish(null);
	};
	// A native drag that nobody stopped takes the gesture over; the browser then sends no pointerup.
	const onDragStart = (event: DragEvent): void => {
		if (!event.defaultPrevented) finish(null);
	};

	doc.addEventListener('pointermove', onMove, { signal });
	doc.addEventListener('pointerup', onUp, { signal });
	doc.addEventListener('pointercancel', onCancel, { signal });
	doc.addEventListener('keydown', onKey, { capture: true, signal });
	doc.addEventListener('selectstart', (event) => event.preventDefault(), { capture: true, signal });
	doc.addEventListener('dragstart', onDragStart, { signal });
	if (touch) followFinger(doc, start, touch, () => finish(null), signal);

	return {
		capture(el: HTMLElement) {
			if (finished || holder) return;
			try {
				el.setPointerCapture(start.pointerId);
				holder = el;
				// Only the capture `el` loses. A finger is captured by the pressed image to begin with, and that
				// capture moving to `el` sends a lostpointercapture from the image, which bubbles up to here.
				el.addEventListener(
					'lostpointercapture',
					(event) => {
						if (event.target === el) onLost(event);
					},
					{ signal },
				);
			} catch {
				/* the pointer is gone already; the document listeners still see the rest */
			}
		},
		cancel: () => finish(null),
		get finished() {
			return finished;
		},
	};
}

/**
 * What a finger press needs besides pointer events, for as long as it lasts.
 *
 * The browser decides by itself to scroll the note when a finger moves, and then cancels the pointer
 * (pointercancel). Pointer events cannot stop that, and touch-action is read once, when the finger lands: by
 * then the press may still turn out to be a swipe that should scroll. The one thing that stops a scroll that
 * has not begun is cancelling the touchmove event, which a passive listener cannot do; so a non-passive
 * touchmove listener is added for the press, and it cancels only while the image is held. (Obsidian's own
 * long-press drags on mobile do the same.)
 */
function followFinger(doc: Document, start: PointerEvent, touch: TouchHold, cancel: () => void, signal: AbortSignal): void {
	const win = doc.defaultView ?? window;
	const holdStill = (event: Event): void => {
		if (!touch.holding()) return;
		if (event.cancelable) event.preventDefault();
		event.stopPropagation();
	};
	doc.addEventListener('touchmove', holdStill, { capture: true, passive: false, signal });
	// Touch events go to the element the finger first touched for as long as it is down, even after that element has
	// left the page (the editor drops an image's widget once a drag has scrolled far enough away). They then no
	// longer pass through the document, so they are also stopped where they arrive (measured: without this the note
	// scrolled under the finger after a long auto-scroll).
	start.target?.addEventListener('touchmove', holdStill, { passive: false, signal });
	// A long press asks for the image's menu (Obsidian's, or the system's); while the finger is on the image,
	// it picks the image up instead.
	doc.addEventListener(
		'contextmenu',
		(event) => {
			keepMenuShut(event);
			touch.onLongPress();
		},
		{ capture: true, signal },
	);
	// A second finger before the image is held is a pinch or a two-finger scroll, not a long press.
	doc.addEventListener(
		'pointerdown',
		(event) => {
			if (event.pointerId !== start.pointerId && !touch.holding()) cancel();
		},
		{ capture: true, signal },
	);
	// The app going to the background ends the press.
	win.addEventListener('blur', cancel, { signal });
	doc.addEventListener(
		'visibilitychange',
		() => {
			if (doc.visibilityState === 'hidden') cancel();
		},
		{ signal },
	);
}

/**
 * Keeps the menu a long press asks for from opening: the event never reaches the image, where Obsidian opens its
 * menu, and the browser's own menu (Android) is cancelled. Obsidian's iPhone and iPad app sends a contextmenu
 * of its own after 0.8 s (an untrusted one, which has no browser menu) and buzzes when it is cancelled, so that
 * one is only stopped.
 */
function keepMenuShut(event: MouseEvent): void {
	if (event.isTrusted) event.preventDefault();
	event.stopPropagation();
}

/** Touch: how long after a finger is lifted its click may still come, in milliseconds. */
const FINGER_CLICK_WAIT = 800;

/**
 * The browser still sends a click where a drag ends, and Obsidian would select (or open) the image under
 * the pointer for it, so the next click is dropped. It waits for the release if the button is still down
 * (a drag cancelled with Escape), and gives up at the next press so a later real click is never eaten; and at a
 * pointercancel (the system took a touch over after the drag was cancelled), which no release and no click follow.
 *
 * After a finger (`touch`), the click comes a little later, once the browser has seen the touch end, so it is
 * waited for a while; a menu asked for as the finger lifts (some systems ask then) is kept shut too; and a click
 * this plugin sends itself (to select the picture, gesture.ts) is let through.
 *
 * Adapted from Adjustable Media (src/view/interactions.ts, swallowNextClick), MIT, (c) 2026 Yi-luo-hua.
 */
export function swallowNextClick(doc: Document, released: boolean, touch = false): void {
	const win = doc.defaultView ?? window;
	const controller = new AbortController();
	const { signal } = controller;
	const done = () => controller.abort();
	doc.addEventListener(
		'click',
		(event) => {
			if (touch && !event.isTrusted) return;
			event.preventDefault();
			event.stopPropagation();
			done();
		},
		{ capture: true, signal },
	);
	if (touch) doc.addEventListener('contextmenu', keepMenuShut, { capture: true, signal });
	doc.addEventListener('pointerdown', done, { capture: true, signal });
	doc.addEventListener('pointercancel', done, { capture: true, signal });
	// The click comes in the same task as the release; anything later is a new click.
	const afterRelease = () => win.setTimeout(done, touch ? FINGER_CLICK_WAIT : 0);
	if (released) afterRelease();
	else doc.addEventListener('pointerup', afterRelease, { capture: true, signal, once: true });
}
