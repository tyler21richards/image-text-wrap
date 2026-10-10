import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	findImageLinks,
	parseImageLinkAt,
	relayout,
	withLayout,
	looksLikeImage,
	ANY_LAYOUT_TOKEN,
	type Layout,
} from '../../src/grammar.ts';

const L = (wrap: Layout['wrap'], gap: Layout['gap'] = 16): Layout => ({ wrap, gap });

function apply(text: string, layout: Layout, pos = 0, inTable = false): string {
	const link = parseImageLinkAt(text, pos, inTable);
	assert.ok(link, `no link at ${pos} in ${text}`);
	return text.slice(0, link.from) + relayout(text, link, layout) + text.slice(link.to);
}

test('parses wikilinks with caption, tokens and size', () => {
	const text = '![[photo.png|A caption|wrap-right|gap-24|300]]';
	const link = parseImageLinkAt(text, 0)!;
	assert.equal(link.kind, 'wiki');
	assert.equal(link.target, 'photo.png');
	assert.deepEqual(link.segments, ['A caption', 'wrap-right', 'gap-24', '300']);
	assert.deepEqual(link.layout, { wrap: 'right', gap: 24 });
	assert.equal(link.to, text.length);
});

test('parses markdown images with alt segments', () => {
	const text = '![A caption|wrap-block|300](photo.png)';
	const link = parseImageLinkAt(text, 0)!;
	assert.equal(link.kind, 'markdown');
	assert.equal(link.target, 'photo.png');
	assert.deepEqual(link.layout, { wrap: 'block', gap: 16 });
	assert.equal(link.to, text.length);
});

test('markdown destinations with angle brackets, titles and parentheses', () => {
	for (const text of [
		'![x|wrap-left](<my photo.png>)',
		'![x|wrap-left](photo.png "A title")',
		'![x|wrap-left](https://example.com/a_(b).png)',
	]) {
		const link = parseImageLinkAt(text, 0)!;
		assert.ok(link, text);
		assert.equal(link.to, text.length, text);
		assert.equal(link.layout.wrap, 'left');
	}
});

test('turning wrap on inserts tokens before the size', () => {
	assert.equal(apply('![[photo.png|300]]', L('left')), '![[photo.png|wrap-left|300]]');
	assert.equal(apply('![[photo.png]]', L('right')), '![[photo.png|wrap-right]]');
	assert.equal(apply('![[photo.png|A caption|300]]', L('right', 24)), '![[photo.png|A caption|wrap-right|gap-24|300]]');
	assert.equal(apply('![](photo.png)', L('left')), '![wrap-left](photo.png)');
	assert.equal(apply('![A caption|300](photo.png)', L('block')), '![A caption|wrap-block|300](photo.png)');
	assert.equal(apply('![A caption](photo.png "t")', L('left', 8)), '![A caption|wrap-left|gap-8](photo.png "t")');
});

test('changing side replaces tokens in place', () => {
	assert.equal(apply('![[photo.png|wrap-left|300]]', L('right')), '![[photo.png|wrap-right|300]]');
	assert.equal(apply('![[photo.png|wrap-left|gap-8|300]]', L('left', 24)), '![[photo.png|wrap-left|gap-24|300]]');
	assert.equal(apply('![[photo.png|wrap-left|gap-8|300]]', L('left', 16)), '![[photo.png|wrap-left|300]]');
});

test('turning wrap off removes layout tokens only', () => {
	assert.equal(apply('![[photo.png|A caption|wrap-right|gap-24|300]]', L('none')), '![[photo.png|A caption|300]]');
	assert.equal(apply('![wrap-left](photo.png)', L('none')), '![](photo.png)');
	assert.equal(apply('![[photo.png|wrap-left]]', L('none')), '![[photo.png]]');
});

test('unknown segments keep their position', () => {
	assert.equal(
		apply('![[photo.png|center|wrap-left|frame|300]]', L('right', 8)),
		'![[photo.png|center|wrap-right|gap-8|frame|300]]',
	);
	assert.equal(apply('![[photo.png|frame|300x200]]', L('left')), '![[photo.png|frame|wrap-left|300x200]]');
});

test('only the link at the position changes', () => {
	const text = '![[a.png|300]] and ![[a.png|300]]';
	const second = text.lastIndexOf('![[');
	assert.equal(apply(text, L('left'), second), '![[a.png|300]] and ![[a.png|wrap-left|300]]');
});

test('table rows use escaped pipes', () => {
	const text = '| x | ![[square.png\\|60]] |';
	const pos = text.indexOf('![[');
	assert.equal(apply(text, L('left'), pos, true), '| x | ![[square.png\\|wrap-left\\|60]] |');
	const link = parseImageLinkAt('![[square.png\\|wrap-left\\|60]]', 0, true)!;
	assert.deepEqual(link.layout, { wrap: 'left', gap: 16 });
});

test('escaped pipes outside tables stay inside one segment', () => {
	const link = parseImageLinkAt('![a\\|b|wrap-left](x.png)', 0)!;
	assert.deepEqual(link.segments, ['a\\|b', 'wrap-left']);
});

test('rejects non-links and links that span lines', () => {
	assert.equal(parseImageLinkAt('![[photo.png', 0), null);
	assert.equal(parseImageLinkAt('![[photo.png\n]]', 0), null);
	assert.equal(parseImageLinkAt('![alt]\n(photo.png)', 0), null);
	assert.equal(parseImageLinkAt('[[photo.png]]', 0), null);
	assert.equal(parseImageLinkAt('![[ ]]', 0), null);
});

test('findImageLinks finds each link on a line', () => {
	const links = findImageLinks('![[a.png|wrap-left]] text ![b](c.png) \\![[not.png]]');
	assert.equal(links.length, 2);
	assert.equal(links[0]!.target, 'a.png');
	assert.equal(links[1]!.target, 'c.png');
});

test('withLayout is idempotent', () => {
	const segs = ['cap', 'wrap-right', 'gap-8', '200'];
	const once = withLayout(segs, L('left', 24));
	assert.deepEqual(withLayout(once, L('left', 24)), once);
});

test('looksLikeImage', () => {
	assert.ok(looksLikeImage('a/b.PNG'));
	assert.ok(looksLikeImage('photo.jpeg#frag'));
	assert.ok(looksLikeImage('https://example.com/x'));
	assert.ok(!looksLikeImage('Some note'));
	assert.ok(!looksLikeImage('doc.pdf'));
});

test('ANY_LAYOUT_TOKEN spots wrap tokens in a note', () => {
	assert.ok(ANY_LAYOUT_TOKEN.test('x ![[a.png|wrap-left|300]] y'));
	assert.ok(ANY_LAYOUT_TOKEN.test('![wrap-right](a.png)'));
	assert.ok(!ANY_LAYOUT_TOKEN.test('we wrap-left text here'));
});
