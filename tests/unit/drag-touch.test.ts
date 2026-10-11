import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	FINGER_GAP,
	ghostByFinger,
	LONG_PRESS_MS,
	LONG_PRESS_SLOP,
	longPressFor,
	pastSlop,
	pastThreshold,
	visibleBand,
} from '../../src/live-preview/drag/geometry.ts';

test('a finger picks an image up after about half a second, resting within about 8 px', () => {
	assert.equal(LONG_PRESS_MS, 500);
	assert.equal(LONG_PRESS_SLOP, 8);
	assert.equal(pastSlop(8, 0), false);
	assert.equal(pastSlop(0, -8), false);
	assert.equal(pastSlop(5, 6), false); // 7.8
	assert.equal(pastSlop(6, 6), true); // 8.5
	assert.equal(pastSlop(0, 9), true);
	// A wobble that would start a mouse drag (past 5 px) does not end a long press.
	assert.equal(pastThreshold(6, 0), true);
	assert.equal(pastSlop(6, 0), false);
});

test('a touch picks an image up with a long press everywhere, a pen only on a phone or tablet', () => {
	assert.equal(longPressFor('touch', true), true);
	assert.equal(longPressFor('touch', false), true);
	// An Apple Pencil or an S Pen works as a finger does.
	assert.equal(longPressFor('pen', true), true);
	// On a desktop a pen (a graphics tablet) drags past 5 px, as the mouse does and as it did in 1.0.0.
	assert.equal(longPressFor('pen', false), false);
	assert.equal(longPressFor('mouse', false), false);
	assert.equal(longPressFor('mouse', true), false);
	// A pointer type the browser does not name goes the mouse's way, as in 1.0.0.
	assert.equal(longPressFor('', false), false);
});

test('the ghost sits centred above the finger, clear of it', () => {
	const screen = { width: 390, height: 844 };
	const at = ghostByFinger(200, 500, 140, 100, screen);
	assert.deepEqual(at, { left: 130, top: 500 - FINGER_GAP - 100 });
	// The finger is never under it.
	assert.ok(at.top + 100 < 500);
});

test('the ghost goes below the finger when there is no room above, and stays in the window', () => {
	const screen = { width: 390, height: 844 };
	assert.deepEqual(ghostByFinger(200, 60, 140, 100, screen), { left: 130, top: 60 + FINGER_GAP });
	// Near the left and right edges it is pushed back in.
	assert.equal(ghostByFinger(10, 500, 140, 100, screen).left, 0);
	assert.equal(ghostByFinger(385, 500, 140, 100, screen).left, 250);
	// Below the finger, but the window ends: it stays inside.
	assert.equal(ghostByFinger(200, 120, 140, 800, screen).top, 44);
	// Bigger than the window: from its top-left corner.
	assert.deepEqual(ghostByFinger(200, 120, 500, 900, screen), { left: 0, top: 0 });
});

const box = (top: number, bottom: number, left = 0, right = 390) => ({ top, bottom, left, right });

test('on a phone the band is the scroller less the view header, the navigation bar and the system bars', () => {
	// Obsidian 1.14.4, phone emulation (390x844): the scroller fills the window, the header floats at 59-104,
	// the navigation bar at 760-812; safe areas 59 and 34 px.
	const scroller = box(0, 844);
	const viewport = { top: 59, bottom: 844 - 34 };
	assert.deepEqual(visibleBand(scroller, viewport, [box(59, 104), box(760, 812, 37, 353)]), { top: 104, bottom: 760 });
	// Without the bars, only the system's.
	assert.deepEqual(visibleBand(scroller, viewport, []), { top: 59, bottom: 810 });
});

test('the keyboard and the editing toolbar above it end the band', () => {
	const scroller = box(0, 792);
	// The visual viewport ends where the keyboard begins (520); the toolbar sits just above it.
	assert.deepEqual(visibleBand(scroller, { top: 59, bottom: 520 }, [box(59, 104), box(476, 520)]), { top: 104, bottom: 476 });
});

test('bars that miss the scroller are ignored', () => {
	// Tablet: the view header sits above the scroller, and does not cover it.
	const scroller = box(151, 768, 0, 1024);
	assert.deepEqual(visibleBand(scroller, { top: 59, bottom: 734 }, [box(99, 151, 0, 1024)]), { top: 151, bottom: 734 });
	// A bar beside the scroller (another pane), or one with no size (not shown).
	assert.deepEqual(visibleBand(box(100, 700, 400, 800), { top: 0, bottom: 900 }, [box(100, 150, 0, 300), box(650, 650)]), {
		top: 100,
		bottom: 700,
	});
});

test('a bar is a top or a bottom bar by the half of the scroller it is in', () => {
	const scroller = box(0, 800);
	assert.deepEqual(visibleBand(scroller, { top: 0, bottom: 800 }, [box(300, 350)]), { top: 350, bottom: 800 });
	assert.deepEqual(visibleBand(scroller, { top: 0, bottom: 800 }, [box(450, 500)]), { top: 0, bottom: 450 });
});

test('when nothing would be left, the band is the whole scroller', () => {
	const scroller = box(100, 300);
	assert.deepEqual(visibleBand(scroller, { top: 0, bottom: 900 }, [box(90, 200), box(200, 310)]), { top: 100, bottom: 300 });
	assert.deepEqual(visibleBand(scroller, { top: 400, bottom: 900 }, []), { top: 100, bottom: 300 });
});
