// The picture toolbar on phones and tablets: where the sheet goes, when it scrolls a picture into view, and
// what it offers. Measured values are from Obsidian 1.14.4's mobile emulation (phone 390 x 844).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GAPS, type Layout } from '../../src/grammar.ts';
import {
	SPACING_CHOICES,
	SPACING_HINT,
	WRAP_CHOICES,
	layoutAfterWrapClick,
	layoutForGap,
} from '../../src/ui/layout-choices.ts';
import { revealScroll, sheetBottom, type Box, type SheetScreen } from '../../src/ui/place-toolbar.ts';

const phone = (over: Partial<SheetScreen> = {}): SheetScreen => ({
	height: 844,
	visual: { top: 0, height: 844 },
	keyboard: 0,
	safeBottom: 34,
	bars: [],
	gap: 8,
	...over,
});
const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });

test('the sheet sits above Obsidian\'s floating navigation bar', () => {
	// The bar is 760..812 on a 844 px phone.
	assert.equal(sheetBottom(phone({ bars: [760] })), 844 - 760 + 8);
});

test('with nothing below it, the sheet stays inside the safe area', () => {
	assert.equal(sheetBottom(phone()), 34 + 8);
	assert.equal(sheetBottom(phone({ safeBottom: 0 })), 8);
});

test('the sheet sits above the keyboard as Obsidian reports it, and above its editing toolbar', () => {
	assert.equal(sheetBottom(phone({ keyboard: 300 })), 300 + 8);
	// The editing toolbar rests at 100vh - keyboard - 52.
	assert.equal(sheetBottom(phone({ keyboard: 300, bars: [844 - 300 - 52] })), 300 + 52 + 8);
});

test('a keyboard that shrinks the visual viewport instead also lifts the sheet', () => {
	assert.equal(sheetBottom(phone({ visual: { top: 0, height: 544 } })), 300 + 8);
	// Obsidian's own report and the visual viewport may both see it: counted once, by the higher edge.
	assert.equal(sheetBottom(phone({ keyboard: 300, visual: { top: 0, height: 544 } })), 300 + 8);
	assert.equal(sheetBottom(phone({ keyboard: 280, visual: { top: 0, height: 544 } })), 300 + 8);
});

test('without a visual viewport (or while zoomed), only the window, the bars and the keyboard count', () => {
	assert.equal(sheetBottom(phone({ visual: null, bars: [760] })), 92);
});

test('a bar below the screen (slid away with the keyboard) does not lift the sheet', () => {
	assert.equal(sheetBottom(phone({ bars: [1060] })), 42);
});

const SHEET_TOP = 566;
const HEADER = 104;

test('a picture clear of the sheet does not scroll', () => {
	assert.equal(revealScroll(box(24, 300, 344, 510), HEADER, SHEET_TOP, 8), 0);
	assert.equal(revealScroll(box(24, 300, 344, SHEET_TOP), HEADER, SHEET_TOP, 8), 0);
});

test('a picture partly under the sheet scrolls up until it is clear of it, with a margin', () => {
	// Bottom at 650: scroll 650 - (566 - 8) = 92.
	assert.equal(revealScroll(box(24, 440, 344, 650), HEADER, SHEET_TOP, 8), 92);
});

test('a picture entirely under the sheet scrolls up into the free space', () => {
	const delta = revealScroll(box(24, 700, 344, 910), HEADER, SHEET_TOP, 8);
	assert.equal(delta, 910 - 558);
	assert.ok(700 - delta >= HEADER + 8);
});

test('a picture taller than the free space shows its top, never scrolled past it', () => {
	// 104 + 8 = 112 is as high as its top may go.
	assert.equal(revealScroll(box(24, 600, 344, 1500), HEADER, SHEET_TOP, 8), 600 - 112);
	// Already showing its top under the header: no scroll at all.
	assert.equal(revealScroll(box(24, 110, 344, 1500), HEADER, SHEET_TOP, 8), 0);
});

test('the sheet\'s buttons carry short visible labels in plain English, in Word\'s order', () => {
	assert.deepEqual(
		WRAP_CHOICES.map((c) => c.short),
		['In line', 'Wrap left', 'Wrap right', 'Top and bottom'],
	);
	assert.deepEqual(
		SPACING_CHOICES.map((c) => [c.gap, c.label]),
		[
			[0, 'None'],
			[8, 'Small'],
			[16, 'Medium'],
			[24, 'Large'],
		],
	);
	assert.deepEqual(SPACING_CHOICES.map((c) => c.gap), [...GAPS]);
	assert.match(SPACING_HINT, /^[A-Z][a-z ]+$/);
});

test('the sheet\'s spacing row only acts on a wrapped picture', () => {
	const inLine: Layout = { wrap: 'none', gap: 16 };
	for (const { gap } of SPACING_CHOICES) assert.equal(layoutForGap(inLine, gap), null);
	assert.deepEqual(layoutForGap({ wrap: 'left', gap: 16 }, 24), { wrap: 'left', gap: 24 });
	// Tapping the pressed wrap choice returns to in line, as on desktop.
	assert.deepEqual(layoutAfterWrapClick({ wrap: 'right', gap: 8 }, 'right', 16), { wrap: 'none', gap: 16 });
});
