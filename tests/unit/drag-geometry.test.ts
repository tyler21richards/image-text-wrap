import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	clamp,
	fitWithin,
	nearestTarget,
	pastThreshold,
	scrollSpeed,
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
