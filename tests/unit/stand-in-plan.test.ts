import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChangeSet, Text } from '@codemirror/state';
import {
	docAnchors,
	editKeepsAnchors,
	estimateBox,
	estimateTextHeight,
	findFloatAnchors,
	moveAnchors,
	type DocAnchor,
	linkSize,
	parseSize,
	planStandIn,
	rowsBefore,
	sameBox,
	stackStandIns,
	standInAnchorTop,
	visibleLength,
	withoutRanges,
	type FloatBox,
	type LineSample,
	type TextMetrics,
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

test('anchors: images wrapped left or right in body-text paragraphs', () => {
	const lines = [
		'# Title', // 0
		'![[a.png|wrap-left|300]]', // 1 yes, alone
		'Text beside it.', // 2
		'', // 3
		'![[b.png|A caption|wrap-right|gap-24|260]]', // 4 yes, alone
		'- ![[c.png|wrap-left]]', // 5 list: no
		'> ![[d.png|wrap-left]]', // 6 quote: no
		'', // 7
		'![[e.png|wrap-block|300]]', // 8 top and bottom: no
		'', // 9
		'```', // 10
		'![[g.png|wrap-left]]', // 11 code: no
		'```', // 12
		'![teal|wrap-right|120](data:image/png;base64,AAAA)', // 13 yes, alone
		'| ![[h.png\\|wrap-left]] |', // 14 table-ish: no
		'', // 15
		'![[f.png|wrap-left]] and text', // 16 yes, inside a sentence
		'', // 17
		'![[i.png|wrap-left|100]] ![[j.png|wrap-right|100]]', // 18 two, alone: a line of wrapped images only
		'', // 19
		'Words ![[k.png|wrap-right|100]] more words ![[l.png|wrap-left|90]] end.', // 20 two inside a sentence
		'', // 21
		'![[m.png|wrap-left|100]] ![[n.png|wrap-block|100]]', // 22 one: the line has an image in line too
		'', // 23
		'# A ![[o.png|wrap-left]] heading', // 24 heading: no
	];
	const anchors = findFloatAnchors(lines);
	assert.deepEqual(
		anchors.map((a) => [a.line, a.side, a.gap, a.alone]),
		[
			[1, 'left', 16, true],
			[4, 'right', 24, true],
			[13, 'right', 16, true],
			[16, 'left', 16, false],
			[18, 'left', 16, true],
			[18, 'right', 16, true],
			[20, 'right', 16, false],
			[20, 'left', 16, false],
			[22, 'left', 16, false],
		],
	);
	// Each one at its own link.
	assert.deepEqual(
		anchors.filter((a) => a.line === 20).map((a) => lines[20]!.slice(a.linkFrom, a.linkTo)),
		['![[k.png|wrap-right|100]]', '![[l.png|wrap-left|90]]'],
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
const fields = (anchors: readonly DocAnchor[]) => anchors.map((a) => [a.line, a.lineFrom, a.lineTo, a.pos, a.raw, a.side, a.gap, a.alone]);

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

test('a list marker added or removed right above a picture is not a shortcut: the picture joins or leaves the item', () => {
	const before = doc(['Intro.', '', 'item', '![[a.png|wrap-left|60]]', 'Text.', '', 'End.']);
	const anchors = docAnchors(before);
	assert.equal(anchors.length, 1);
	const marker = ChangeSet.of({ from: before.line(3).from, insert: '- ' }, before.length);
	assert.equal(moveAnchors(anchors, before, marker, marker.apply(before)), null);
	assert.deepEqual(docAnchors(marker.apply(before)), []);
	// Plain typing in that line is still a shortcut.
	const typing = ChangeSet.of({ from: before.line(3).from, insert: 'an ' }, before.length);
	assert.deepEqual(fields(moveAnchors(anchors, before, typing, typing.apply(before))!), fields(docAnchors(typing.apply(before))));
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
		'Text with ![[g.png|wrap-left|50]] inside a sentence.',
		'',
		'![[h.png|wrap-left|40]] ![[i.png|wrap-right|40]]',
		'Text beside two pictures.',
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

const sample = (text: string | null, mapHeight = 80, floats = false): LineSample => ({ text, mapHeight, floats });
const metrics: TextMetrics = { lineWidth: 700, lineInset: 0, charWidth: 7.3125, lineHeight: 24 };
/** A 788px picture 350px wide on the right, with a 16px gap: text beside it has 334px. */
const tall = box({ width: 350, height: 788, marginBottom: 8 });
const paragraph = 'x'.repeat(307);

test('a picture never drawn: the text below its line is counted as drawn beside it, not as the height map guesses', () => {
	// Measured on the stress note: three paragraphs of 307 characters, each 7 rows of 24px beside the
	// picture (the height map guessed 80px), and three blank lines: 576px.
	const blocks = [paragraph, '', paragraph, '', paragraph, ''].map((t) => sample(t));
	assert.equal(estimateTextHeight(blocks, tall, metrics), 576);
	// Past the picture's bottom (108px), rows have the full width: 5 narrow rows and one full one, then
	// 4 full rows instead of 7.
	const short = box({ width: 350, height: 100, marginBottom: 8 });
	assert.equal(estimateTextHeight([sample(paragraph), sample(paragraph)], short, metrics), (5 + 1) * 24 + 4 * 24);
});

test('estimate: lines of wrapped images take no height; what cannot be counted keeps the height map height', () => {
	assert.equal(estimateTextHeight([sample('![[a.png|wrap-left]]', 100, true), sample('Short.')], tall, metrics), 24);
	// A heading, a list item, a line with a pipe or an image, and a block of several lines (a table).
	for (const text of ['# Heading', '- item', 'a | b', 'An ![[inline.png]] image', null]) {
		assert.equal(estimateTextHeight([sample(text, 37)], tall, metrics), 37, String(text));
	}
	// Plain lines right after a list item continue it, up to the next blank line.
	assert.equal(estimateTextHeight([sample('- item', 30), sample('lazy', 50), sample(''), sample('Plain.')], tall, metrics), 30 + 50 + 24 + 24);
	// After a fence nothing is counted any more: code, math or a comment follows.
	assert.equal(estimateTextHeight([sample('```', 20), sample('code', 21), sample('', 22)], tall, metrics), 63);
});

test('estimate: links are counted by the text Live Preview shows, and counting stops past the limit', () => {
	assert.equal(visibleLength('See [[Some note|the note]] and [[Other]] or [a link](https://example.com/x).'), 'See the note and Other or a link.'.length);
	assert.equal(visibleLength('**Bold** and ==marked== and `code`'), 'Bold and marked and code'.length);
	const many = Array.from({ length: 100 }, () => sample(paragraph));
	assert.ok(estimateTextHeight(many, tall, metrics, 796) < 796 + 7 * 24);
});

test('estimate: a picture inside a sentence starts on the row of its link, and the rows above it are full width', () => {
	assert.equal(rowsBefore('', metrics), 0);
	// 100 characters take 731px: more than one row of 700px, so the picture starts on the second row.
	assert.equal(rowsBefore('y'.repeat(100), metrics), 24);
	const line = 'Words ![[k.png|wrap-right]] more ![[l.png|wrap-left]] end.';
	assert.equal(
		withoutRanges(line, [
			{ from: 33, to: 53 },
			{ from: 6, to: 27 },
		]),
		'Words  more  end.',
	);
	// Its own line holds 307 characters: one full row above the picture (700px), then narrow rows.
	const inLine = { ...tall, layoutTop: 24 };
	assert.equal(estimateTextHeight([sample(paragraph)], inLine, metrics, Infinity, 24), 24 + 5 * 24);
});
