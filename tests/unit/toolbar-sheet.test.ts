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
import {
	SHORT_WINDOW,
	keyboardShown,
	revealScroll,
	revealTop,
	sheetBottom,
	sheetForm,
	sheetTop,
	type Box,
	type SheetHeader,
	type SheetRoom,
	type SheetScreen,
} from '../../src/ui/place-toolbar.ts';

const phone = (over: Partial<SheetScreen> = {}): SheetScreen => ({
	height: 844,
	visual: { top: 0, height: 844 },
	keyboard: 0,
	safeBottom: 34,
	safeTop: 59,
	bars: [],
	gap: 8,
	...over,
});
const box = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });
/** The phone's header bar, 59..104, shown; with auto full screen it slides away as the note scrolls down. */
const header = (over: Partial<SheetHeader> = {}): SheetHeader => ({ bottom: 104, restingBottom: 104, hidesOnScroll: false, ...over });
const NO_HEADER: SheetHeader = { bottom: -Infinity, restingBottom: -Infinity, hidesOnScroll: false };

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

// Phone in landscape, as measured in the emulation: 844 x 390, the floating navigation bar at 306, the
// header 59..104, the top safe area 59 (the emulation keeps the portrait insets).
const landscape = (over: Partial<SheetScreen> = {}): SheetScreen =>
	phone({ height: 390, visual: { top: 0, height: 390 }, bars: [306], ...over });
/**
 * Obsidian's editing toolbar above a keyboard of `kb` px, with the navigation bar taken out. Obsidian puts its
 * top at calc(100vh - var(--keyboard-height) - var(--mobile-toolbar-height)), and --mobile-toolbar-height is
 * 52 px (the 44 px bar and 8 px above the keyboard).
 */
const typing = (kb: number, height = 390): Partial<SheetScreen> => ({ keyboard: kb, bars: [height - kb - 52] });
/** The sheet's heights as measured: full on a phone (186 portrait, 169 landscape) and on a tablet (178), compact 69. */
const COMPACT = 69;
const ROOM = 88;
/** The plugin's rule: two rows of 44 px of the note for the full sheet, one for the compact one. */
const ROOMS: SheetRoom = { full: 88, compact: 44 };
/** A sheet measured `full` px tall in its full form; records which forms were measured. */
const heights = (full: number, compact = COMPACT) => {
	const measured: string[] = [];
	return {
		measured,
		of: (isCompact: boolean) => {
			measured.push(isCompact ? 'compact' : 'full');
			return isCompact ? compact : full;
		},
	};
};

test('the sheet fits under the header with room for the note: its top edge', () => {
	// Portrait, the full sheet (186 px) above the floating navigation bar at 760.
	assert.equal(sheetTop(phone({ bars: [760] }), 186, header(), ROOM), 844 - 92 - 186);
	// Portrait with a 300 px keyboard and the editing toolbar (52 px) above it: still plenty of note above it.
	assert.equal(sheetTop(phone({ keyboard: 300, bars: [492] }), 186, header(), ROOM), 492 - 8 - 186);
	// Landscape, the compact sheet: above the navigation bar's resting place.
	assert.equal(sheetTop(landscape(), COMPACT, header(), ROOM), 306 - 8 - COMPACT);
});

test('with the keyboard up on a phone in landscape the sheet does not fit, and hides rather than leave the screen', () => {
	// The full sheet (169 px) with a 200 px keyboard: its top would be at -39, off the screen.
	assert.equal(sheetTop(landscape(typing(200)), 169, header(), ROOM), null);
	// The compact sheet still leaves no room for the note under the header (its top 61 is above it).
	assert.equal(sheetForm(landscape(typing(200)), header(), ROOMS, heights(169).of), null);
	// With the emulation's top inset, a 120 px keyboard leaves 37 px of note: not even one row.
	assert.equal(sheetForm(landscape(typing(120)), header(), ROOMS, heights(169).of), null);
});

test('a phone in landscape with a small keyboard and no top inset shows the compact sheet, with a row or more of the note above it', () => {
	// A real iPhone has no top inset in landscape, and its header rests higher (12..57).
	const real = (kb: number) => landscape({ ...typing(kb), safeTop: 0 });
	const low = header({ bottom: 57, restingBottom: 57 });
	// 120 px: the editing toolbar's top at 218, the sheet's at 141, 84 px of note under the header.
	assert.deepEqual(sheetForm(real(120), low, ROOMS, heights(169).of), { compact: true, top: 390 - 120 - 52 - 8 - COMPACT });
	assert.deepEqual(sheetForm(real(160), low, ROOMS, heights(169).of), { compact: true, top: 57 + 44 });
	assert.equal(sheetForm(real(161), low, ROOMS, heights(169).of), null);
	assert.equal(sheetForm(real(200), low, ROOMS, heights(169).of), null);
});

test('the room is counted from where the header rests, so the sheet does not come and go as the header slides', () => {
	const slidAway = header({ bottom: 1, restingBottom: 104 });
	assert.equal(sheetTop(landscape(typing(120)), COMPACT, slidAway, 44), null);
	assert.equal(sheetTop(landscape(), COMPACT, slidAway, ROOM), sheetTop(landscape(), COMPACT, header(), ROOM));
});

test('without a header, the top safe area and the top of the screen bound the sheet', () => {
	// The sheet's top at 141, the top safe area 59 px.
	assert.equal(sheetTop(landscape(typing(120)), COMPACT, NO_HEADER, 141 - 59), 141);
	assert.equal(sheetTop(landscape(typing(120)), COMPACT, NO_HEADER, 141 - 59 + 1), null);
	assert.equal(sheetTop(landscape({ ...typing(120), safeTop: 0 }), COMPACT, NO_HEADER, 141), 141);
	assert.equal(sheetTop(landscape({ ...typing(120), safeTop: 0 }), COMPACT, NO_HEADER, 142), null);
});

// A tablet in landscape, as measured in the emulation: 1024 x 768, no navigation bar, no safe areas, the tab
// bar and the note's header over the note down to 151.
const tablet = (over: Partial<SheetScreen> = {}): SheetScreen =>
	phone({ height: 768, visual: { top: 0, height: 768 }, safeBottom: 0, safeTop: 0, ...over });
const TABLET_HEADER = header({ bottom: 151, restingBottom: 151 });

test('the full sheet shows while it leaves two rows of the note in view; the compact one is not measured then', () => {
	const h = heights(186);
	assert.deepEqual(sheetForm(phone({ bars: [760] }), header(), ROOMS, h.of), { compact: false, top: 844 - 92 - 186 });
	assert.deepEqual(h.measured, ['full']);
	// A tablet with a 290 px keyboard: the full sheet (178 px) leaves 89 px under the header.
	assert.deepEqual(sheetForm(tablet(typing(290, 768)), TABLET_HEADER, ROOMS, heights(178).of), { compact: false, top: 768 - 290 - 52 - 8 - 178 });
});

test('a tablet whose keyboard leaves too little room for the full sheet shows the compact one, which fits', () => {
	for (const kb of [300, 350, 400]) {
		const h = heights(178);
		const top = 768 - kb - 52 - 8 - COMPACT;
		assert.deepEqual(sheetForm(tablet(typing(kb, 768)), TABLET_HEADER, ROOMS, h.of), { compact: true, top }, `keyboard ${kb}`);
		assert.ok(top - 151 >= 44, `keyboard ${kb}: ${top - 151} px of note`);
		assert.deepEqual(h.measured, ['full', 'compact']);
	}
	// Only a keyboard that leaves less than a row of the note even then hides it.
	assert.equal(sheetForm(tablet(typing(445, 768)), TABLET_HEADER, ROOMS, heights(178).of), null);
});

test('a short window (a phone in landscape) always has the compact sheet, even where the full one would fit', () => {
	// 480 px tall, no inset, the header resting at 57 and the navigation bar at 400: the full sheet (169 px)
	// would leave 166 px of the note, but the picture it is for would not fit above it.
	const h = heights(169);
	const short = phone({ height: SHORT_WINDOW - 20, visual: null, safeTop: 0, bars: [400] });
	assert.deepEqual(sheetForm(short, header({ bottom: 57, restingBottom: 57 }), ROOMS, h.of), { compact: true, top: 400 - 8 - COMPACT });
	assert.deepEqual(h.measured, ['compact']);
	// One px taller is a window like any other.
	const tall = phone({ height: SHORT_WINDOW + 1, visual: null, safeTop: 0, bars: [421] });
	assert.equal(sheetForm(tall, header({ bottom: 57, restingBottom: 57 }), ROOMS, heights(169).of)?.compact, false);
});

test('a keyboard is up when Obsidian reports one or the visual viewport ends above the window\'s bottom', () => {
	assert.equal(keyboardShown(phone()), false);
	assert.equal(keyboardShown(phone({ visual: null })), false);
	assert.equal(keyboardShown(phone({ keyboard: 300 })), true);
	assert.equal(keyboardShown(phone({ visual: { top: 0, height: 544 } })), true);
});

test('a reveal brings the picture up to below the header, or to below the top safe area when the header slides away', () => {
	assert.equal(revealTop(phone(), header(), 0), 104);
	// Auto full screen: the reveal's scroll sends the header away, freeing its place.
	assert.equal(revealTop(phone(), header({ hidesOnScroll: true }), 0), 59);
	assert.equal(revealTop(phone({ safeTop: 0 }), header({ hidesOnScroll: true }), 0), 0);
	// Already slid away: the status bar still counts.
	assert.equal(revealTop(phone(), header({ bottom: 1 }), 0), 59);
	// A tablet: the header sits above the note, whose scroller starts below it.
	assert.equal(revealTop(phone({ safeTop: 0 }), header({ bottom: 80, restingBottom: 80 }), 80), 80);
});

test('phone landscape: the picture (210 px) fits between the status bar and the compact sheet once the header slides away', () => {
	const screen = landscape();
	const top = sheetTop(screen, COMPACT, header(), ROOMS.compact);
	assert.ok(top !== null);
	// Tapped low on the screen, under where the sheet goes.
	const picture = box(72, 295, 392, 505);
	const delta = revealScroll(picture, revealTop(screen, header({ hidesOnScroll: true }), 0), top, 8);
	const after = { top: picture.top - delta, bottom: picture.bottom - delta };
	assert.ok(after.top >= 59 + 8, `top ${after.top}`);
	assert.ok((top - after.top) / 210 >= 0.7, `${top - after.top} of 210 px above the sheet`);
	// With the header staying (auto full screen off), the header bounds it and a strip stays under the sheet.
	const stays = revealScroll(picture, revealTop(screen, header(), 0), top, 8);
	assert.equal(picture.top - stays, 104 + 8);
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
