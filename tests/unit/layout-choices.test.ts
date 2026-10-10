import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Layout } from '../../src/grammar.ts';
import {
	WRAP_CHOICES,
	layoutAfterWrapClick,
	layoutForGap,
	layoutForWrapCommand,
	onlyImageLinksChanged,
	pickLinkAtCursor,
} from '../../src/ui/layout-choices.ts';

const L = (wrap: Layout['wrap'], gap: Layout['gap'] = 16): Layout => ({ wrap, gap });

test('the toolbar offers Word\'s four layouts in order, in English', () => {
	assert.deepEqual(
		WRAP_CHOICES.map((c) => [c.wrap, c.label]),
		[
			['none', 'In line with text'],
			['left', 'Wrap text left'],
			['right', 'Wrap text right'],
			['block', 'Top and bottom'],
		],
	);
});

test('turning wrapping on from in line uses the default spacing', () => {
	assert.deepEqual(layoutAfterWrapClick(L('none'), 'left', 24), L('left', 24));
	assert.deepEqual(layoutAfterWrapClick(L('none', 8), 'block', 0), L('block', 0));
});

test('clicking the active wrap choice turns wrapping off', () => {
	assert.deepEqual(layoutAfterWrapClick(L('left', 24), 'left', 16), L('none'));
	assert.deepEqual(layoutAfterWrapClick(L('block', 8), 'block', 16), L('none'));
});

test('switching sides keeps the spacing the image has', () => {
	assert.deepEqual(layoutAfterWrapClick(L('left', 8), 'right', 24), L('right', 8));
	assert.deepEqual(layoutAfterWrapClick(L('right', 0), 'block', 24), L('block', 0));
});

test('"in line with text" always means no layout', () => {
	assert.deepEqual(layoutAfterWrapClick(L('right', 24), 'none', 16), L('none'));
	assert.deepEqual(layoutAfterWrapClick(L('none'), 'none', 16), L('none'));
});

test('a wrap command does not apply when the image already has that layout', () => {
	assert.equal(layoutForWrapCommand(L('left'), 'left', 16), null);
	assert.equal(layoutForWrapCommand(L('none'), 'none', 16), null);
	assert.deepEqual(layoutForWrapCommand(L('left', 8), 'none', 16), L('none'));
	assert.deepEqual(layoutForWrapCommand(L('none'), 'right', 8), L('right', 8));
});

test('spacing applies only while wrapped, and only when it changes', () => {
	assert.equal(layoutForGap(L('none'), 8), null);
	assert.equal(layoutForGap(L('left', 8), 8), null);
	assert.deepEqual(layoutForGap(L('left', 16), 0), L('left', 0));
	assert.deepEqual(layoutForGap(L('block', 24), 8), L('block', 8));
});

test('commands pick the image link under the cursor, else the only one on the line', () => {
	const line = 'See ![[a.png|100]] and ![[b.png|wrap-left]] here';
	assert.equal(pickLinkAtCursor(line, 6)?.target, 'a.png');
	assert.equal(pickLinkAtCursor(line, 4)?.target, 'a.png'); // just before the link
	assert.equal(pickLinkAtCursor(line, 23)?.target, 'b.png');
	assert.equal(pickLinkAtCursor(line, 0), null); // two links, cursor on neither
	assert.equal(pickLinkAtCursor('![[only.png]] text', 16)?.target, 'only.png');
	assert.equal(pickLinkAtCursor('![[Some note]]', 3), null); // a transclusion, not an image
	assert.equal(pickLinkAtCursor('| x | ![[t.png\\|60]] |', 8, true)?.target, 't.png');
});

test('recognises a change that only rewrote image links (an undo of a layout change)', () => {
	assert.equal(onlyImageLinksChanged('![[a.png|300]]', '![[a.png|wrap-left|300]]'), true);
	assert.equal(onlyImageLinksChanged('Text ![x|wrap-right](u.png) end', 'Text ![x](u.png) end'), true);
	assert.equal(onlyImageLinksChanged('![[a.png]]', '![[a.png]]'), false); // no change
	assert.equal(onlyImageLinksChanged('![[a.png]] one', '![[a.png]] two'), false); // text changed
	assert.equal(onlyImageLinksChanged('![[a.png]]', '![[b.png]]'), false); // another image
	assert.equal(onlyImageLinksChanged('plain', 'plainer'), false);
	assert.equal(onlyImageLinksChanged('![[a.png]]', '![[a.png]] ![[a.png]]'), false);
});
