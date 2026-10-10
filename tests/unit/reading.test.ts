import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embedHasFloat, keepWithNext, textHasFloat, wrapFromAlt } from '../../src/reading/wraps.ts';
import { planHost, reachedHosts, type FloatBox } from '../../src/reading/stand-in-plan.ts';

test('a note has a float only for wrap-left or wrap-right images in body text', () => {
	assert.equal(textHasFloat('# Title\n\n![[a.png|wrap-left|300]]\nText'), true);
	assert.equal(textHasFloat('![Caption|wrap-right|120](https://example.com/a.png)\nText'), true);
	assert.equal(textHasFloat('![[a.png|A caption|wrap-right|gap-24|300]]'), true);
	// Top and bottom does not float.
	assert.equal(textHasFloat('![[a.png|wrap-block|300]]'), false);
	assert.equal(textHasFloat('No images here, only the words wrap-left and wrap-right.'), false);
	// A token that is not a whole segment does not count.
	assert.equal(textHasFloat('![[a.png|wrap-lefty|300]]'), false);
});

test('images in code, math, comments, frontmatter and tables do not count', () => {
	assert.equal(textHasFloat('```\n![[a.png|wrap-left]]\n```\nText'), false);
	assert.equal(textHasFloat('$$\n![[a.png|wrap-left]]\n$$'), false);
	assert.equal(textHasFloat('%%\n![[a.png|wrap-left]]\n%%'), false);
	assert.equal(textHasFloat('---\nimage: "![[a.png|wrap-left]]"\n---\nText'), false);
	assert.equal(textHasFloat('| A | B |\n| --- | --- |\n| x | ![[a.png\\|wrap-left\\|60]] |'), false);
	// Lists and quotes do count: their images float inside them.
	assert.equal(textHasFloat('- ![[a.png|wrap-left|60]] item'), true);
	assert.equal(textHasFloat('> ![[a.png|wrap-right|60]] quoted'), true);
});

test('an embed from the metadata cache', () => {
	assert.equal(embedHasFloat('![[landscape.png|wrap-left|300]]'), true);
	assert.equal(embedHasFloat('![[tall.png|A tall picture|wrap-right|260]]'), true);
	assert.equal(embedHasFloat('![[landscape.png|wrap-block|360]]'), false);
	assert.equal(embedHasFloat('![[square.png\\|60]]'), false);
	assert.equal(embedHasFloat('![[Transcluded source]]'), false);
});

test('the wrap of a rendered image comes from its alt', () => {
	assert.equal(wrapFromAlt('wrap-left'), 'left');
	assert.equal(wrapFromAlt('A tall picture|wrap-right'), 'right');
	assert.equal(wrapFromAlt('teal|wrap-right|gap-8'), 'right');
	assert.equal(wrapFromAlt('wrap-block'), 'block');
	assert.equal(wrapFromAlt('square.png'), 'none');
	assert.equal(wrapFromAlt(null), 'none');
});

test('a heading right before a float block keeps with it in print', () => {
	assert.deepEqual(keepWithNext(['heading', 'float', 'other']), [true, false, false]);
	assert.deepEqual(keepWithNext(['other', 'float', 'float']), [false, false, false]);
	assert.deepEqual(keepWithNext(['heading', 'other', 'float']), [false, false, false]);
	assert.deepEqual(keepWithNext(['heading', 'heading', 'float']), [false, true, false]);
	assert.deepEqual(keepWithNext([]), []);
});

const right = (top: number, bottom: number): FloatBox => ({ side: 'right', top, bottom, imgTop: top, width: 260, gap: 16 });

test('a float reaches the sections that start above its bottom', () => {
	const hosts = [100, 300, 500, 700].map((top) => ({ top, skip: false }));
	assert.deepEqual(reachedHosts(right(0, 600), hosts), [0, 1, 2]);
	assert.deepEqual(reachedHosts(right(0, 100.2), hosts), []);
	assert.deepEqual(reachedHosts(right(0, 101), hosts), [0]);
});

test('a stand-in is the part of the float below the host top', () => {
	const plans = planHost(225, [{ index: 0, box: { ...right(-7, 592), imgTop: -7 } }]);
	assert.equal(plans.length, 1);
	assert.deepEqual(
		{ ...plans[0]! },
		{ float: 0, host: 0, side: 'right', marginTop: 0, height: 367, offset: 232, width: 260, gap: 16 },
	);
	// A float that ends above the host gets none.
	assert.deepEqual(planHost(600, [{ index: 0, box: right(0, 590) }]), []);
});

test('same-side stand-ins stack; the other side starts at the host top', () => {
	const plans = planHost(100, [
		{ index: 0, box: right(0, 300) },
		{ index: 1, box: right(300, 450) },
		{ index: 2, box: { ...right(50, 250), side: 'left' } },
	]);
	assert.deepEqual(
		plans.map((p) => [p.side, p.marginTop, p.height, p.offset]),
		[
			['right', 0, 200, 100],
			['right', 0, 150, 0],
			['left', 0, 150, 50],
		],
	);
	// A later float that starts below the earlier one's end keeps its own top.
	const gap = planHost(100, [
		{ index: 0, box: right(0, 200) },
		{ index: 1, box: right(260, 400) },
	]);
	assert.deepEqual(gap.map((p) => [p.marginTop, p.height]), [[0, 100], [60, 140]]);
	// Stand-ins already in the host for earlier images push new same-side ones down.
	const after = planHost(100, [{ index: 0, box: right(150, 400) }], { right: 300 });
	assert.deepEqual(after.map((p) => [p.marginTop, p.height]), [[0, 250]]);
});
