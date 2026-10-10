// Follows one pointer gesture from press to release.
//
// Adapted from Adjustable Media (src/view/pointer.ts, trackPointer), MIT, (c) 2026 Yi-luo-hua. Changes:
// every listener hangs on one AbortController, so the gesture can be cancelled from outside (editor
// destroyed, plugin unloaded); and the pointer is captured only when the caller asks (once the press has
// become a drag), because capturing at the press would retarget the click that selects the image.

export interface PointerHandlers {
	onMove(event: PointerEvent): void;
	onEnd(event: PointerEvent): void;
	/** The gesture was interrupted (Escape, pointercancel, lost capture, a missed release, a native drag). */
	onCancel(): void;
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
export function trackPointer(doc: Document, start: PointerEvent, handlers: PointerHandlers): TrackedPointer {
	const controller = new AbortController();
	const { signal } = controller;
	let finished = false;
	let holder: HTMLElement | null = null;

	const finish = (ended: PointerEvent | null): void => {
		if (finished) return;
		finished = true;
		controller.abort();
		try {
			if (holder?.hasPointerCapture(start.pointerId)) holder.releasePointerCapture(start.pointerId);
		} catch {
			/* the pointer is gone already */
		}
		if (ended) handlers.onEnd(ended);
		else handlers.onCancel();
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

	return {
		capture(el: HTMLElement) {
			if (finished || holder) return;
			try {
				el.setPointerCapture(start.pointerId);
				holder = el;
				el.addEventListener('lostpointercapture', onCancel, { signal });
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
 * The browser still sends a click where a drag ends, and Obsidian would select (or open) the image under
 * the pointer for it, so the next click is dropped. It waits for the release if the button is still down
 * (a drag cancelled with Escape), and gives up at the next press so a later real click is never eaten.
 *
 * Adapted from Adjustable Media (src/view/interactions.ts, swallowNextClick), MIT, (c) 2026 Yi-luo-hua.
 */
export function swallowNextClick(doc: Document, released: boolean): void {
	const win = doc.defaultView ?? window;
	const controller = new AbortController();
	const { signal } = controller;
	const done = () => controller.abort();
	doc.addEventListener(
		'click',
		(event) => {
			event.preventDefault();
			event.stopPropagation();
			done();
		},
		{ capture: true, signal },
	);
	doc.addEventListener('pointerdown', done, { capture: true, signal });
	// The click comes in the same task as the release; anything later is a new click.
	const afterRelease = () => win.setTimeout(done, 0);
	if (released) afterRelease();
	else doc.addEventListener('pointerup', afterRelease, { capture: true, signal, once: true });
}
