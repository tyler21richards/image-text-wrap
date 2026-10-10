import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChangeSet, Text } from '@codemirror/state';
import {
	docAnchors,
	editKeepsAnchors,
	estimateBox,
	findFloatAnchors,
	moveAnchors,
	type DocAnchor,
	linkSize,
	parseSize,
	planStandIn,
	sameBox,
	stackStandIns,
	standInAnchorTop,
	type FloatBox,
} from '../../src/live-preview/stand-in-plan.ts';

const box = (over: Partial<FloatBox> = {}): FloatBox => ({
	side: 'right',
	layoutTop: 0,
	width: 260,
	height: 585,
	margin: 16,
	inset: 0,
	marginTop: 0,
	marginBottom: 0,
	...over,
});

test('no stand-in once the picture ends above the first drawn line', () => {
	// Picture from 100 to 685; first drawn line starts at 685 (or within the 1px tolerance).
	assert.equal(planStandIn(100, box(), 685), null);
	assert.equal(planStandIn(100, box(), 685.5), null);
	assert.notEqual(planStandIn(100, box(), 683), null);
});

test('a picture starting above the line is pulled up by as much and keeps its full height', () => {
	const plan = planStandIn(100, box(), 400)!;
	assert.equal(plan.shift, 300);
	assert.equal(plan.marginTop, -300);
	assert.equal(plan.sandbag, 0);
	assert.equal(plan.height, 285);
});

test('the bottom margin counts towards what reaches the line', () => {
	assert.equal(planStandIn(0, box({ height: 100 }), 100.5), null);
	const plan = planStandIn(0, box({ height: 100, marginBottom: 8 }), 100.5)!;
	assert.equal(plan.shift, 100.5);
	assert.equal(plan.height, 7.5);
});

test('a picture starting below the line sits under a sandbag that keeps its own top margin', () => {
	// Pushed down 40px below its line by an earlier float, line top at 0, image line at -10.
	const plan = planStandIn(-10, box({ layoutTop: 50, marginTop: 4 }), 0)!;
	assert.equal(plan.shift, 0);
	assert.equal(plan.sandbag, 36);
	assert.equal(plan.marginTop, 4);
	// Less room than its margin: the margin shrinks instead.
	const tight = planStandIn(0, box({ layoutTop: 2, marginTop: 4 }), 0)!;
	assert.equal(tight.sandbag, 0);
	assert.equal(tight.marginTop, 2);
});

test('stand-ins in front of one line stack: each sandbag holds only what lies below the earlier ones', () => {
	const plans = [
		{ sandbag: 0, shift: 120, height: 200, marginTop: -120 },
		{ sandbag: 80, shift: 0, height: 100, marginTop: 0 },
		{ sandbag: 300, shift: 0, height: 100, marginTop: 0 },
	];
	const stacked = stackStandIns(plans);
	assert.deepEqual(
		stacked.map((p) => p.sandbag),
		[0, 80, 220],
	);
	// A float drawn apart above (the cursor's line) already starts 100px below the line.
	assert.deepEqual(
		stackStandIns(plans, 100).map((p) => p.sandbag),
		[0, 0, 200],
	);
});

test('the stand-in follows the line beside the picture when it was measured with one', () => {
	const b = box({ layoutTop: 30, refPos: 500, refOffset: 6 });
	assert.equal(standInAnchorTop(b, 1000, null), 1000);
	// The line beside it is now at 1040: the picture top is 1046, so its own line is at 1016.
	assert.equal(standInAnchorTop(b, 1000, 1040), 1016);
	assert.equal(standInAnchorTop(box(), 1000, 1040), 1000);
});

test('estimate: stored width, capped at the wrap width, keeping the aspect ratio', () => {
	const base = { side: 'left' as const, lineWidth: 700, lineInset: 0, maxPercent: 50, gap: 16, marginBottom: 0 };
	const a = estimateBox({ ...base, size: { width: 300 }, natural: { width: 640, height: 420 } })!;
	assert.equal(a.width, 300);
	assert.equal(a.height, 196.875);
	const capped = estimateBox({ ...base, size: { width: 600 }, natural: { width: 640, height: 420 } })!;
	assert.equal(capped.width, 350);
	const own = estimateBox({ ...base, size: null, natural: { width: 200, height: 100 } })!;
	assert.equal(own.width, 200);
	assert.equal(own.height, 100);
	const fromLink = estimateBox({ ...base, size: { width: 300, height: 150 }, natural: null })!;
	assert.equal(fromLink.height, 150);
	assert.equal(estimateBox({ ...base, size: { width: 300 }, natural: null }), null);
	assert.equal(a.margin, 16);
});

test('sizes written in links', () => {
	assert.deepEqual(parseSize('300'), { width: 300 });
	assert.deepEqual(parseSize(' 300x200 '), { width: 300, height: 200 });
	assert.equal(parseSize('wrap-left'), null);
	assert.equal(parseSize(undefined), null);
});

test('anchors: only body-text lines holding nothing but one image wrapped left or right', () => {
	const lines = [
		'# Title', // 0
		'![[a.png|wrap-left|300]]', // 1 yes
		'Text beside it.', // 2
		'', // 3
		'![[b.png|A caption|wrap-right|gap-24|260]]', // 4 yes
		'- ![[c.png|wrap-left]]', // 5 list: no
		'> ![[d.png|wrap-left]]', // 6 quote: no
		'![[e.png|wrap-block|300]]', // 7 top and bottom: no
		'![[f.png|wrap-left]] and text', // 8 text on the line: no
		'```', // 9
		'![[g.png|wrap-left]]', // 10 code: no
		'```', // 11
		'![teal|wrap-right|120](data:image/png;base64,AAAA)', // 12 yes
		'| ![[h.png\\|wrap-left]] |', // 13 table-ish: no
	];
	const anchors = findFloatAnchors(lines);
	assert.deepEqual(
		anchors.map((a) => [a.line, a.side, a.gap]),
		[
			[1, 'left', 16],
			[4, 'right', 24],
			[12, 'right', 16],
		],
	);
	assert.equal(anchors[1]!.raw, '![[b.png|A caption|wrap-right|gap-24|260]]');
	assert.deepEqual(linkSize(anchors[1]!.link), { width: 260 });
	assert.deepEqual(linkSize(anchors[2]!.link), { width: 120 });
});

test('boxes equal to the half pixel', () => {
	assert.ok(sameBox(box(), box({ height: 585.3 })));
	assert.ok(!sameBox(box(), box({ height: 586 })));
	assert.ok(!sameBox(box(), box({ refPos: 3, refOffset: 0 })));
	assert.ok(sameBox(undefined, undefined));
	assert.ok(!sameBox(box(), undefined));
});

const edited = (lines: string[], above?: string, below?: string) => ({ lines, above, below });

test('an edit keeps the anchors when it only touches ordinary text', () => {
	// Typing inside a paragraph between blank lines.
	assert.ok(editKeepsAnchors(edited(['Some text'], '', ''), edited(['Some texts'], '', ''), false));
	// Inside a block of text lines with no blank line around.
	assert.ok(editKeepsAnchors(edited(['two'], 'one', 'three'), edited(['two and more'], 'one', 'three'), false));
	// Splitting a paragraph in two with a blank line, between blank lines.
	assert.ok(editKeepsAnchors(edited(['One. Two.'], '', ''), edited(['One.', '', 'Two.'], '', ''), false));
	// Typing in the text glued under a wrapped image: the image's line is not edited.
	assert.ok(editKeepsAnchors(edited(['Beside it.'], '![[a.png|wrap-left]]', ''), edited(['Beside it, more.'], '![[a.png|wrap-left]]', ''), false));
	// A paragraph turned into a heading between blank lines ends no table that was not ended already.
	assert.ok(editKeepsAnchors(edited(['Text'], '', ''), edited(['# Text'], '', ''), false));
});

test('an edit of a wrap, a pipe, a delimiter row, a fence or frontmatter scans the note again', () => {
	for (const line of ['![[a.png|wrap-left]]', 'a | b', '```', '~~~ js', '$$', '%%', '<!--', '-->', '---', '...', '-', ':--:', 'WRAP-RIGHT']) {
		assert.ok(!editKeepsAnchors(edited(['text'], '', ''), edited([line], '', ''), false), line);
		assert.ok(!editKeepsAnchors(edited([line], '', ''), edited(['text'], '', ''), false), line);
	}
	// The note's first line may start frontmatter.
	assert.ok(!editKeepsAnchors(edited(['text'], undefined, ''), edited(['texts'], undefined, ''), true));
});

test('an edit that may end a table, or stop ending one, scans the note again', () => {
	// A blank line appears in a block of text (it would end a table above it).
	assert.ok(!editKeepsAnchors(edited(['two'], 'one', 'three'), edited(['', 'two'], 'one', 'three'), false));
	// A heading, quote or list item appears, or one goes.
	assert.ok(!editKeepsAnchors(edited(['two'], 'one', 'three'), edited(['# two'], 'one', 'three'), false));
	assert.ok(!editKeepsAnchors(edited(['> two'], 'one', 'three'), edited(['two'], 'one', 'three'), false));
	assert.ok(!editKeepsAnchors(edited(['two'], 'one', 'three'), edited(['- two'], 'one', 'three'), false));
});

const doc = (lines: string[]) => Text.of(lines);
const fields = (anchors: readonly DocAnchor[]) => anchors.map((a) => [a.line, a.lineFrom, a.lineTo, a.pos, a.raw, a.side, a.gap]);

test('anchors move with an edit in ordinary text and are found again otherwise', () => {
	const before = doc(['# Title', '', 'Intro text.', '', '![[a.png|wrap-left|300]]', 'Beside it.', '', 'More text.', '', '![b|wrap-right](b.png)', 'End.']);
	const anchors = docAnchors(before);
	assert.deepEqual(anchors.map((a) => a.line), [4, 9]);
	// Typing two words into "Intro text."
	const at = before.line(3).from + 5;
	const typing = ChangeSet.of({ from: at, insert: ' more words' }, before.length);
	const after = typing.apply(before);
	const moved = moveAnchors(anchors, before, typing, after)!;
	assert.ok(moved);
	assert.deepEqual(fields(moved), fields(docAnchors(after)));
	// Opening a code fence above the anchors changes them: no shortcut.
	const fence = ChangeSet.of({ from: at, insert: '\n```\n' }, before.length);
	assert.equal(moveAnchors(anchors, before, fence, fence.apply(before)), null);
	// Typing in the text glued under a picture keeps it.
	const glued = ChangeSet.of({ from: before.line(6).from, insert: 'Right ' }, before.length);
	const gluedAfter = glued.apply(before);
	assert.deepEqual(fields(moveAnchors(anchors, before, glued, gluedAfter)!), fields(docAnchors(gluedAfter)));
	// A delimiter row under a picture's line would make it a table's header: no shortcut.
	const row = ChangeSet.of({ from: before.line(6).from, to: before.line(6).to, insert: ':--' }, before.length);
	assert.equal(moveAnchors(anchors, before, row, row.apply(before)), null);
});

test('whenever anchors are moved rather than found again, they are what a new scan finds', () => {
	const base = [
		'---',
		'title: x',
		'---',
		'# Heading',
		'',
		'Text before.',
		'',
		'![[a.png|wrap-left|300]]',
		'Text beside the first picture.',
		'',
		'| h | i |',
		'|---|---|',
		'| 1 | 2 |',
		'Row text',
		'![[b.png|wrap-right]]',
		'',
		'```',
		'![[c.png|wrap-left]]',
		'```',
		'',
		'- item',
		'![[d.png|wrap-right|200]]',
		'',
		'> quote',
		'',
		'Plain paragraph one.',
		'Plain paragraph two.',
		'',
		...Array.from({ length: 12 }, (_, i) => [`Filler paragraph ${i + 1}, with a few ordinary words in it.`, '']).flat(),
		'$$',
		'x',
		'$$',
		'![e|wrap-left|120](e.png)',
		'Last words.',
	];
	const snippets = ['x', ' ', 'word ', '\n', '\n\n', '|', '```', '$$', '# ', '- ', '> ', '---', '1. ', '%%', 'wrap-left', '![[f.png|wrap-left]]', '\t'];
	let seed = 7;
	const random = (n: number) => {
		seed = (seed * 1103515245 + 12345) % 2147483648;
		return seed % n;
	};
	let moved = 0;
	for (let round = 0; round < 3000; round++) {
		const before = doc(base);
		const anchors = docAnchors(before);
		const from = random(before.length + 1);
		const del = random(4) === 0 ? Math.min(before.length - from, random(12)) : 0;
		const insert = random(3) === 0 ? '' : snippets[random(snippets.length)]!;
		if (!del && !insert) continue;
		const changes = ChangeSet.of({ from, to: from + del, insert }, before.length);
		const after = changes.apply(before);
		const result = moveAnchors(anchors, before, changes, after);
		if (!result) continue;
		moved++;
		assert.deepEqual(fields(result), fields(docAnchors(after)), `round ${round}: ${JSON.stringify({ from, del, insert })}`);
	}
	// Ordinary typing takes the shortcut.
	assert.ok(moved > 1000, `moved ${moved}`);
});
