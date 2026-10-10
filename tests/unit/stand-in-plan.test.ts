import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	estimateBox,
	findFloatAnchors,
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
