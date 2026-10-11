import { test } from 'node:test';
import assert from 'node:assert/strict';
import { embedHasFloat, keepWithNext, layoutFromAlt, textHasFloat, wrapFromAlt } from '../../src/reading/wraps.ts';
import { drawnWidth, floatFrom, moveFloat, narrowing, planHost, reachedHosts, reshapeFloat, type FloatBox } from '../../src/reading/stand-in-plan.ts';

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

const right = (top: number, bottom: number): FloatBox => ({ side: 'right', top, bottom, imgTop: top, imgHeight: bottom - top - 8, width: 260, gap: 16, inset: 0 });

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
		{ float: 0, host: 0, side: 'right', marginTop: 0, height: 367, offset: 232, width: 260, gap: 16, pictureHeight: 591 },
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

test('a float moved against its hosts, as when its section is re-rendered off the page', () => {
	const box = { ...right(-100, 400), imgTop: -100 };
	// In the coordinates of a host that starts at 200.
	assert.deepEqual(floatFrom(box, 200), { ...box, top: -300, bottom: 200, imgTop: -300 });
	// Its section grew by 24px: everything after it moved down, so against its hosts it moved up.
	assert.deepEqual(moveFloat(box, 24), { ...box, top: -124, bottom: 376, imgTop: -124 });
	// Planned again in that host (top 0 in host coordinates), the stand-in is 24px shorter.
	const plan = (b: FloatBox) => planHost(0, [{ index: 0, box: b }]).map((p) => [p.height, p.offset]);
	assert.deepEqual(plan(floatFrom(box, 200)), [[200, 300]]);
	assert.deepEqual(plan(moveFloat(floatFrom(box, 200), 24)), [[176, 324]]);
	// 48px shorter: it reaches 48px further into the host. 200px taller: it no longer reaches it.
	assert.deepEqual(plan(moveFloat(floatFrom(box, 200), -48)), [[248, 252]]);
	assert.deepEqual(plan(moveFloat(floatFrom(box, 200), 200)), []);
});

test('the layout of a rendered image from its alt', () => {
	assert.deepEqual(layoutFromAlt('A tall picture|wrap-left|gap-24'), { ...layoutFromAlt('wrap-left'), gap: 24 });
	assert.equal(layoutFromAlt('wrap-right').gap, 16);
	assert.equal(layoutFromAlt(null).wrap, 'none');
});

test('a float whose link was edited off the page: another side, size or spacing where it stands', () => {
	// The fixture's tall picture, 260x585, in the coordinates of a host it reaches 361px into.
	const box: FloatBox = { side: 'right', top: -232, bottom: 361, imgTop: -232, imgHeight: 585, width: 260, gap: 16, inset: 0 };
	// Wrap text left instead: the same float on the other side.
	assert.deepEqual(reshapeFloat(box, { side: 'left', width: 260, gap: 16 }), { ...box, side: 'left' });
	// 240px wide: the picture keeps its aspect ratio and its top, so it ends 45px higher.
	const narrower = reshapeFloat(box, { side: 'right', width: 240, gap: 16 });
	assert.equal(narrower.imgHeight, 540);
	assert.equal(narrower.bottom, 316);
	assert.equal(narrower.top, box.top);
	// Planned again in that host: the stand-in is 45px shorter.
	assert.deepEqual(
		planHost(0, [{ index: 0, box: narrower }]).map((p) => [p.width, p.height, p.pictureHeight]),
		[[240, 316, 540]],
	);
});

test('the width a wrapped image is drawn at after its link changed', () => {
	// 260 asked, drawn 260 (under the cap): 240 asked is drawn 240, 400 asked is held at the cap.
	assert.equal(drawnWidth(240, 260, 260, 350), 240);
	assert.equal(drawnWidth(400, 260, 260, 350), 350);
	// Drawn narrower than asked: it was held at the cap, so the cap is what was drawn.
	assert.equal(drawnWidth(600, 500, 350, 999), 350);
	assert.equal(drawnWidth(300, 500, 350, 999), 300);
});

test('a section that keeps floats to itself is narrowed as the floats beside it narrow it', () => {
	const tall: FloatBox = { side: 'right', top: -40, bottom: 635, imgTop: -40, imgHeight: 667, width: 300, gap: 16, inset: 0 };
	assert.deepEqual(narrowing([tall]), { left: 0, right: 316 });
	// The widest on each side; one that ends above the section does not count.
	const left: FloatBox = { ...tall, side: 'left', width: 200, gap: 24, inset: 4 };
	const above: FloatBox = { ...tall, width: 500, bottom: 0 };
	assert.deepEqual(narrowing([tall, left, above]), { left: 228, right: 316 });
	assert.deepEqual(narrowing([]), { left: 0, right: 0 });
});
