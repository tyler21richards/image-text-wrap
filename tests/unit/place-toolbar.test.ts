import { test } from 'node:test';
import assert from 'node:assert/strict';
import { placeToolbar, visiblePart, type Box, type PlaceInput } from '../../src/ui/place-toolbar.ts';

const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });
const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

/** Obsidian's controls on a picture: zoom/edit at the top right, the resize corner at the bottom right. */
function controls(image: Box): Box[] {
	return [
		box(image.right - 70, image.top + 8, image.right - 8, image.top + 36),
		box(image.right - 30, image.bottom - 30, image.right, image.bottom),
	];
}

function input(image: Box, over: Partial<PlaceInput> = {}): PlaceInput {
	return {
		image,
		visible: box(350, 80, 1270, 900),
		column: box(460, 0, 1160, 99999),
		width: 165,
		height: 34,
		avoid: controls(image),
		gap: 8,
		margin: 4,
		...over,
	};
}

function toolbarBox(p: PlaceInput, at: { left: number; top: number }): Box {
	return box(at.left, at.top, at.left + p.width, at.top + p.height);
}

test('sits just above the picture, at its left edge', () => {
	const p = input(box(462, 300, 782, 500));
	assert.deepEqual(placeToolbar(p), { left: 462, top: 258, where: 'above' });
});

test('goes below when there is no room above inside the visible scroller', () => {
	const p = input(box(462, 90, 782, 300));
	assert.deepEqual(placeToolbar(p), { left: 462, top: 308, where: 'below' });
});

test('hides when the picture is scrolled out of view', () => {
	assert.equal(placeToolbar(input(box(462, -400, 782, 80))), null);
	assert.equal(placeToolbar(input(box(462, 900, 782, 1100))), null);
	assert.equal(visiblePart(box(0, 0, 10, 10), box(20, 20, 30, 30)), null);
});

test('stays inside the note column for a picture on the right', () => {
	const p = input(box(1042, 300, 1162, 380));
	const at = placeToolbar(p)!;
	assert.equal(at.where, 'above');
	assert.equal(at.left, 1160 - 165);
});

test('a picture taller than the visible area: inside its top-left corner, clear of the controls', () => {
	const image = box(462, 100, 862, 1500);
	const p = input(image);
	const at = placeToolbar(p)!;
	assert.equal(at.where, 'inside');
	assert.deepEqual(at, { left: 470, top: 108, where: 'inside' });
	for (const c of p.avoid) assert.equal(overlaps(toolbarBox(p, at), c), false);
});

test('a narrow tall picture: the toolbar moves down past the zoom and edit buttons', () => {
	const image = box(462, 100, 642, 1500); // 180 px wide: a 165 px toolbar would touch the buttons
	const p = input(image);
	const at = placeToolbar(p)!;
	assert.equal(at.where, 'inside');
	for (const c of p.avoid) assert.equal(overlaps(toolbarBox(p, at), c), false, JSON.stringify({ at, c }));
	assert.ok(at.top >= p.avoid[0]!.bottom + p.gap);
});

test('a tall picture scrolled so its top is out of view: pinned to the top of the visible area', () => {
	const p = input(box(462, -500, 862, 1500));
	const at = placeToolbar(p)!;
	assert.deepEqual(at, { left: 470, top: 92, where: 'inside' });
});

test('never leaves the visible scroller vertically', () => {
	for (let top = -600; top <= 900; top += 37) {
		const p = input(box(462, top, 782, top + 700));
		const at = placeToolbar(p);
		if (!at) continue;
		const b = toolbarBox(p, at);
		assert.ok(b.top >= p.visible.top + p.margin && b.bottom <= p.visible.bottom - p.margin, JSON.stringify({ top, at }));
		for (const c of p.avoid) assert.equal(overlaps(b, c), false, JSON.stringify({ top, at, c }));
	}
});

test('a column narrower than the toolbar: aligned to the column', () => {
	const p = input(box(462, 300, 562, 400), { column: box(460, 0, 560, 9999) });
	assert.equal(placeToolbar(p)!.left, 460);
});
