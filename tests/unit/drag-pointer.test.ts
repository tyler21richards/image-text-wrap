// How a press ends and what is left waiting afterwards (src/live-preview/drag/pointer.ts), on a stand-in document
// that keeps its listeners in a list: no browser needed.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { swallowNextClick, trackPointer, type PointerHandlers } from '../../src/live-preview/drag/pointer.ts';

interface Listener {
	type: string;
	fn: (event: FakeEvent) => void;
	once: boolean;
}

interface FakeEvent {
	type: string;
	isTrusted: boolean;
	cancelable: boolean;
	defaultPrevented: boolean;
	preventDefault(): void;
	stopPropagation(): void;
	[key: string]: unknown;
}

class FakeTarget {
	readonly listeners: Listener[] = [];

	addEventListener(type: string, fn: (event: FakeEvent) => void, options: { once?: boolean; signal?: AbortSignal } = {}): void {
		if (options.signal?.aborted) return;
		const entry = { type, fn, once: !!options.once };
		this.listeners.push(entry);
		options.signal?.addEventListener('abort', () => this.remove(entry));
	}

	removeEventListener(): void {
		/* every listener here hangs on a signal */
	}

	private remove(entry: Listener): void {
		const i = this.listeners.indexOf(entry);
		if (i >= 0) this.listeners.splice(i, 1);
	}

	/** Sends an event, trusted unless told otherwise, and returns it. */
	fire(type: string, props: Record<string, unknown> = {}): FakeEvent {
		const event: FakeEvent = {
			type,
			isTrusted: true,
			cancelable: true,
			defaultPrevented: false,
			preventDefault() {
				this.defaultPrevented = true;
			},
			stopPropagation() {},
			...props,
		};
		for (const entry of [...this.listeners]) {
			if (entry.type !== type || !this.listeners.includes(entry)) continue;
			if (entry.once) this.remove(entry);
			entry.fn(event);
		}
		return event;
	}

	count(type?: string): number {
		return this.listeners.filter((l) => type === undefined || l.type === type).length;
	}
}

class FakeWindow extends FakeTarget {
	setTimeout(fn: () => void, ms: number): ReturnType<typeof setTimeout> {
		return setTimeout(fn, ms);
	}
}

class FakeDocument extends FakeTarget {
	readonly defaultView = new FakeWindow();
	visibilityState = 'visible';
}

const asDoc = (doc: FakeDocument) => doc as unknown as Document;
const press = (pointerType: string, pointerId = 1) => ({ pointerId, pointerType, target: null, clientX: 0, clientY: 0 }) as unknown as PointerEvent;

/** Follows a press and records how it ended. */
function follow(doc: FakeDocument, pointerType: string, finger: boolean) {
	const ends: string[] = [];
	const handlers: PointerHandlers = {
		onMove: () => {},
		onEnd: () => ends.push('end'),
		onCancel: (gone) => ends.push(gone ? 'cancel: gone' : 'cancel: still down'),
	};
	const touch = finger ? { holding: () => true, onLongPress: () => {} } : undefined;
	const pointer = trackPointer(asDoc(doc), press(pointerType), handlers, touch);
	return { ends, pointer };
}

test('a cancelled pointer ends the press as gone: no release and no click follow it', () => {
	const doc = new FakeDocument();
	const { ends, pointer } = follow(doc, 'touch', true);
	// Another finger's cancel is not this press's.
	doc.fire('pointercancel', { pointerId: 2 });
	assert.deepEqual(ends, []);
	doc.fire('pointercancel', { pointerId: 1 });
	assert.deepEqual(ends, ['cancel: gone']);
	assert.equal(pointer.finished, true);
	// Every listener of the press is gone with it, on the document and on the window.
	assert.equal(doc.count(), 0);
	assert.equal(doc.defaultView.count(), 0);
	// It ends once.
	pointer.cancel();
	doc.fire('pointerup', { pointerId: 1 });
	assert.deepEqual(ends, ['cancel: gone']);
});

test('the other cancels leave the pointer down: its release and its click still come', () => {
	const escape = new FakeDocument();
	const a = follow(escape, 'mouse', false);
	escape.fire('keydown', { key: 'Escape' });
	assert.deepEqual(a.ends, ['cancel: still down']);

	const fromOutside = new FakeDocument();
	const b = follow(fromOutside, 'touch', true);
	b.pointer.cancel();
	assert.deepEqual(b.ends, ['cancel: still down']);

	const hidden = new FakeDocument();
	const c = follow(hidden, 'touch', true);
	hidden.defaultView.fire('blur');
	assert.deepEqual(c.ends, ['cancel: still down']);

	const missedRelease = new FakeDocument();
	const d = follow(missedRelease, 'mouse', false);
	missedRelease.fire('pointermove', { pointerId: 1, pointerType: 'mouse', buttons: 0 });
	assert.deepEqual(d.ends, ['cancel: still down']);

	const released = new FakeDocument();
	const e = follow(released, 'pen', false);
	released.fire('pointerup', { pointerId: 1 });
	assert.deepEqual(e.ends, ['end']);
});

test('after a cancel with the finger still down, the click its release brings is dropped, and only that one', () => {
	mock.timers.enable({ apis: ['setTimeout'] });
	try {
		const doc = new FakeDocument();
		swallowNextClick(asDoc(doc), false, true);
		doc.fire('pointerup', { pointerId: 1 });
		// A click this plugin sends itself (to select the picture) goes through.
		assert.equal(doc.fire('click', { isTrusted: false }).defaultPrevented, false);
		assert.equal(doc.fire('click').defaultPrevented, true);
		assert.equal(doc.fire('click').defaultPrevented, false);
		assert.equal(doc.count(), 0);

		// No click within the wait after the release: the guard gives up.
		const quiet = new FakeDocument();
		swallowNextClick(asDoc(quiet), false, true);
		quiet.fire('pointerup', { pointerId: 1 });
		mock.timers.tick(800);
		assert.equal(quiet.count(), 0);
		assert.equal(quiet.fire('click').defaultPrevented, false);
	} finally {
		mock.timers.reset();
	}
});

test('a pointercancel ends a guard that waits for a release: none comes, and the next click goes through', () => {
	// Escape, or the app going to the background, then the system takes the touch over (touchcancel).
	for (const touch of [true, false]) {
		const doc = new FakeDocument();
		swallowNextClick(asDoc(doc), false, touch);
		assert.ok(doc.count('click') > 0);
		doc.fire('pointercancel', { pointerId: 1 });
		assert.equal(doc.count(), 0);
		assert.equal(doc.fire('click').defaultPrevented, false);
	}
});

test('a new press ends the guard too, so a later real click is never eaten', () => {
	const doc = new FakeDocument();
	swallowNextClick(asDoc(doc), false, false);
	doc.fire('pointerdown', { pointerId: 2 });
	assert.equal(doc.count(), 0);
	assert.equal(doc.fire('click').defaultPrevented, false);
});
