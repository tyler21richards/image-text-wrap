// When the phone and tablet sheet lets taps through to the note: for a moment after it appears, and then
// until every press that began meanwhile has ended, its click included.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from '../../src/ui/pass-through.ts';

test('a sheet that has just appeared lets taps through until the wait for a double tap is over', () => {
	const taps = new PassThrough();
	assert.equal(taps.active, false);
	taps.start();
	assert.equal(taps.active, true);
	assert.equal(taps.settle(), false);
	taps.waitOver();
	assert.equal(taps.settle(), true);
	assert.equal(taps.active, false);
	// Once only.
	assert.equal(taps.settle(), false);
});

test('a quick double tap: the second press ends, click and all, within the wait', () => {
	const taps = new PassThrough();
	taps.start();
	taps.press(2);
	assert.equal(taps.lift(2), true);
	taps.clicked();
	assert.equal(taps.settle(), false);
	taps.waitOver();
	assert.equal(taps.settle(), true);
});

test('a slow double tap: a press that began during the wait is let through to its end, however long it lasts, and its click', () => {
	const taps = new PassThrough();
	taps.start();
	taps.press(7);
	taps.waitOver();
	// Still down after the wait: the sheet keeps letting taps through.
	assert.equal(taps.settle(), false);
	assert.equal(taps.active, true);
	// Lifted: its click is still to come, aimed at what is under the finger now.
	assert.equal(taps.lift(7), true);
	assert.equal(taps.settle(), false);
	taps.clicked();
	assert.equal(taps.settle(), true);
});

test('a press that a scroll took over brings no click: the sheet takes taps again at once', () => {
	const taps = new PassThrough();
	taps.start();
	taps.press(3);
	taps.waitOver();
	assert.equal(taps.settle(), false);
	taps.cancel(3);
	assert.equal(taps.settle(), true);
});

test('presses after the wait, or before the sheet appeared, are not waited for', () => {
	const taps = new PassThrough();
	taps.press(1);
	taps.start();
	// The tap that brought the sheet up lifts after it appeared: not one of its presses.
	assert.equal(taps.lift(1), false);
	taps.waitOver();
	assert.equal(taps.settle(), true);
	taps.press(4);
	assert.equal(taps.lift(4), false);
	assert.equal(taps.active, false);
});

test('two fingers: the sheet waits for both', () => {
	const taps = new PassThrough();
	taps.start();
	taps.press(5);
	taps.press(6);
	taps.waitOver();
	assert.equal(taps.lift(5), true);
	taps.clicked();
	assert.equal(taps.settle(), false);
	assert.equal(taps.lift(6), true);
	taps.clicked();
	assert.equal(taps.settle(), true);
});

test('hiding the sheet forgets everything; showing it again starts afresh', () => {
	const taps = new PassThrough();
	taps.start();
	taps.press(8);
	taps.stop();
	assert.equal(taps.active, false);
	assert.equal(taps.lift(8), false);
	taps.start();
	taps.waitOver();
	assert.equal(taps.settle(), true);
});
