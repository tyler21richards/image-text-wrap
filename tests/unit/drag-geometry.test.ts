import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	clamp,
	fitWithin,
	landingRise,
	landingShortfall,
	nearestTarget,
	pastThreshold,
	scrollSpeed,
	shiftAt,
	sideAt,
	SCROLL_SPEED,
} from '../../src/live-preview/drag/geometry.ts';

test('a drag starts only past 5 px', () => {
	assert.equal(pastThreshold(5, 0), false);
	assert.equal(pastThreshold(3, 4), false); // exactly 5
	assert.equal(pastThreshold(4, 4), true); // 5.66
	assert.equal(pastThreshold(0, -6), true);
});

test('the side is the half of the column the pointer is in', () => {
	assert.equal(sideAt(100, 100, 700), 'left');
	assert.equal(sideAt(399, 100, 700), 'left');
	assert.equal(sideAt(400, 100, 700), 'right');
	assert.equal(sideAt(900, 100, 700), 'right');
	assert.equal(sideAt(0, 100, 700), 'left');
});

test('auto-scroll ramps up inside the 48 px band and is full speed beyond the edge', () => {
	const top = 100;
	const bottom = 900;
	assert.equal(scrollSpeed(500, top, bottom), 0);
	assert.equal(scrollSpeed(148, top, bottom), 0);
	assert.equal(scrollSpeed(124, top, bottom), -SCROLL_SPEED / 2);
	assert.equal(scrollSpeed(100, top, bottom), -SCROLL_SPEED);
	assert.equal(scrollSpeed(20, top, bottom), -SCROLL_SPEED);
	assert.equal(scrollSpeed(852, top, bottom), 0);
	assert.equal(scrollSpeed(876, top, bottom), SCROLL_SPEED / 2);
	assert.equal(scrollSpeed(2000, top, bottom), SCROLL_SPEED);
});

test('the nearest target by line top', () => {
	const tops = [10, 50, 120, 300];
	const at = (i: number) => tops[i]!;
	assert.equal(nearestTarget(tops.length, at, -100), 0);
	assert.equal(nearestTarget(tops.length, at, 29), 0);
	assert.equal(nearestTarget(tops.length, at, 30), 0); // tie goes to the earlier target
	assert.equal(nearestTarget(tops.length, at, 31), 1);
	assert.equal(nearestTarget(tops.length, at, 200), 2);
	assert.equal(nearestTarget(tops.length, at, 220), 3);
	assert.equal(nearestTarget(tops.length, at, 5000), 3);
	assert.equal(nearestTarget(0, at, 10), -1);
});

test('targets sharing a top (a fold) count as the first of them', () => {
	const tops = [10, 100, 100, 100, 400];
	const at = (i: number) => tops[i]!;
	assert.equal(nearestTarget(tops.length, at, 105), 1);
	assert.equal(nearestTarget(tops.length, at, 99), 1);
});

test('below the note the end of the note wins, even when the last line takes no height', () => {
	// The last line holds only a wrapped image (0 high), so its top is the note's bottom, as is the end's.
	const tops = [10, 100, 298, 298];
	const at = (i: number) => tops[i]!;
	// Without the end flag the end can never win.
	assert.equal(nearestTarget(tops.length, at, 304), 2);
	assert.equal(nearestTarget(tops.length, at, 900), 2);
	// With it, anything below the note picks the end; on or above the bottom nothing changes.
	assert.equal(nearestTarget(tops.length, at, 299, true), 3);
	assert.equal(nearestTarget(tops.length, at, 900, true), 3);
	assert.equal(nearestTarget(tops.length, at, 298, true), 2);
	assert.equal(nearestTarget(tops.length, at, 250, true), 2);
	assert.equal(nearestTarget(tops.length, at, 20, true), 0);
	// A note whose last line has height: the same answers as before.
	const plain = [10, 100, 274, 298];
	const atPlain = (i: number) => plain[i]!;
	for (const y of [0, 90, 280, 290, 298, 500]) assert.equal(nearestTarget(plain.length, atPlain, y, true), nearestTarget(plain.length, atPlain, y), `y ${y}`);
});

test('nearestTarget only looks at a few targets', () => {
	let calls = 0;
	const at = (i: number) => {
		calls++;
		return i * 20;
	};
	assert.equal(nearestTarget(100000, at, 123456), 6173);
	assert.ok(calls < 60, `binary search, ${calls} lookups`);
});

test('fitWithin scales down only', () => {
	assert.deepEqual(fitWithin(300, 200, 240, 240), { width: 240, height: 160 });
	assert.deepEqual(fitWithin(100, 800, 240, 240), { width: 30, height: 240 });
	assert.deepEqual(fitWithin(100, 50, 240, 240), { width: 100, height: 50 });
	assert.deepEqual(fitWithin(0, 0, 240, 240), { width: 0, height: 0 });
});

test('clamp', () => {
	assert.equal(clamp(5, 0, 10), 5);
	assert.equal(clamp(-5, 0, 10), 0);
	assert.equal(clamp(50, 0, 10), 10);
	assert.equal(clamp(5, 10, 0), 10); // an empty range keeps the minimum
});

test('shiftAt: a position moves with the part of the note it is in', () => {
	// Parts start at these positions; the image's own line (0) and what is above it do not move.
	const shifts = [
		{ pos: 0, by: 0 },
		{ pos: 40, by: -24 },
		{ pos: 90, by: -48 },
		{ pos: 300, by: -72 },
	];
	assert.equal(shiftAt(shifts, 0), 0);
	assert.equal(shiftAt(shifts, 39), 0);
	assert.equal(shiftAt(shifts, 40), -24);
	assert.equal(shiftAt(shifts, 89), -24);
	assert.equal(shiftAt(shifts, 90), -48);
	// Past the last part drawn (a gap stands for the rest), as the last part.
	assert.equal(shiftAt(shifts, 5000), -72);
	// Before the first part, or nothing measured: no shift.
	assert.equal(shiftAt([{ pos: 100, by: -10 }], 50), 0);
	assert.equal(shiftAt([], 10), 0);
});

/** Original line tops now, and with the image gone: line 0 is a wrapped image (no height), 1-3 wrap beside it. */
const NOW = [0, 0, 72, 96, 168, 192, 216, 240];
const FLOWED = [0, 0, 48, 72, 120, 144, 168, 192];
const top = (i: number) => NOW[i]!;
const flowedTop = (i: number) => FLOWED[i]!;

test('landingRise: the text the image wrapped re-flows, and lines taken out above go', () => {
	// Only the image's line goes (it has no height): the landing rises by the re-flow above it.
	assert.equal(landingRise(5, { from: 0, to: 1 }, top, flowedTop), 48);
	// A blank line taken out with it (line 1 here, 48px tall once re-flowed) rises it further.
	assert.equal(landingRise(5, { from: 0, to: 2 }, top, flowedTop), 96);
	// Lines taken out below the landing (an image moved up) do not move it; nor does anything below it.
	assert.equal(landingRise(2, { from: 5, to: 7 }, top, () => 0), 72);
	assert.equal(landingRise(2, { from: 5, to: 7 }, top, top), 0);
	// The link shared its line: nothing whole goes.
	assert.equal(landingRise(5, { from: 0, to: 0 }, top, flowedTop), 48);
	// A removal reaching past the landing counts only down to it.
	assert.equal(landingRise(1, { from: 0, to: 3 }, top, flowedTop), 0);
});

test('landingShortfall: what the view cannot make up for by scrolling up', () => {
	assert.equal(landingShortfall(72, 0), 72);
	assert.equal(landingShortfall(72, 40), 32);
	assert.equal(landingShortfall(72, 72), 0);
	assert.equal(landingShortfall(72, 500), 0);
	assert.equal(landingShortfall(0, 0), 0);
	// The landing goes down (lines grew above it): the note can always scroll down to follow.
	assert.equal(landingShortfall(-30, 0), 0);
	// Elastic overscroll can leave a negative scroll position for a moment.
	assert.equal(landingShortfall(72, -10), 72);
});
