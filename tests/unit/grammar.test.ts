import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
	findImageLinks,
	isExternalTarget,
	isLayoutToken,
	layoutFromSegments,
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
	// It also spots segments with spaces, which findImageLinks then reads exactly.
	assert.ok(ANY_LAYOUT_TOKEN.test('![[a.png| wrap-left |300]]'));
	assert.ok(ANY_LAYOUT_TOKEN.test('![ wrap-block](a.png)'));
});

// What Obsidian 1.14.4 draws, measured in Live Preview and Reading view (each case its own paragraph).
// Where the two views differ, the grammar follows the one that draws no image.

test('links inside inline code, inline math and one-line comments are not images', () => {
	const none = [
		'Write `![[a.png|wrap-left|120]]` to embed a picture.',
		'Double ``![[a.png|120]]`` and ``a ` ![[a.png|120]]``.',
		'a ```![[a.png|60]]``` b',
		'a `b`` ![[a.png|60]] c`', // a run of one closes only at a run of one
		'`unclosed ![[a.png|60]]', // Live Preview shows the rest of the line as code
		'Comment %%![[a.png|120]]%% and x %% ![[a.png|60]] %% y',
		'a <!-- ![[a.png|60]] --> b',
		'a <!-- ![[a.png|60]]', // Live Preview comments out the rest
		'$![[a.png|60]]$ and $x ![[a.png|60]] y$',
		'costs $5 and ![[a.png|60]] costs 6$ more',
		'$a $b ![[a.png|60]] c$', // a "$" after a space does not close; the next one does
		'a$x ![[a.png|60]] y$ b',
		'$x ![[a.png|60]] y$a',
		'a $$![[a.png|60]]$$ b and a $$ ![[a.png|60]] $$ b',
		'a $$x ![[a.png|60]]', // Live Preview opens a math block there
		'Markdown: `![alt|120](square.png)` here.',
	];
	for (const line of none) assert.deepEqual(findImageLinks(line), [], line);
});

test('links next to inline code, math and comments are still found', () => {
	const one = [
		'a `b` ![[a.png|60]]',
		'![[a.png|60]] b `c', // the unclosed code starts after the link
		'\\`![[a.png|60]]\\`', // escaped backticks are text
		'a `b\\` ![[a.png|60]]', // a backslash does not escape inside code
		'a ` %% ` ![[a.png|60]] ` %% `',
		'a %%x%% ![[a.png|60]] %%y%%',
		'%%%% ![[a.png|60]]',
		'x %% unclosed ![[a.png|60]]',
		'costs $5 and ![[a.png|60]] costs $6', // no closing "$" before a digit
		'$ ![[a.png|60]] $', // no math with a space after the opening "$"
		'$x ![[a.png|60]] $', // nor before the closing one
		'$\tx ![[a.png|60]] y$',
		'\\$x ![[a.png|60]] y$',
		'a $x$ ![[a.png|60]] $y$',
		'$x$![[a.png|60]]$y$',
		'a $x ![[a.png|60]]',
		'`$` ![[a.png|60]] `$`',
		'![[a.png|a $b|60]] c$', // math cannot start inside a link
		'\\\\![[a.png|60]]', // an escaped backslash, then a link
	];
	for (const line of one) assert.equal(findImageLinks(line).length, 1, line);
	assert.equal(findImageLinks('\\![[a.png|60]]').length, 0);
});

test('markdown alt text ends at the first "]" and has no unescaped "["', () => {
	for (const text of [
		'![a [b] c|wrap-right](images/tall.png)',
		'![a \\[b\\] c|wrap-right](images/tall.png)',
		'![a \\] c|wrap-right](images/tall.png)',
		'![a [b c|wrap-right](images/tall.png)',
		'![a [b]|wrap-right](images/tall.png)',
		'![[b]|wrap-right](images/tall.png)',
		'![a ]b|wrap-right](images/tall.png)',
		'![a `]` b|wrap-right](images/tall.png)',
	]) {
		assert.equal(parseImageLinkAt(text, 0), null, text);
		assert.deepEqual(findImageLinks(text), [], text);
	}
	assert.deepEqual(parseImageLinkAt('![a \\[b c|wrap-right](x.png)', 0)?.segments, ['a \\[b c', 'wrap-right']);
	assert.equal(parseImageLinkAt('![a `b` c|wrap-right](x.png)', 0)?.layout.wrap, 'right');
	// Wikilinks keep brackets in the caption.
	assert.equal(parseImageLinkAt('![[x.png|a [b] c|wrap-right]]', 0)?.layout.wrap, 'right');
	assert.equal(parseImageLinkAt('![[x.png|a ]b|wrap-right]]', 0)?.layout.wrap, 'right');
	assert.equal(apply('![a \\[b c|300](x.png)', L('left')), '![a \\[b c|wrap-left|300](x.png)');
});

test('a token counts only as styles.css sees it in the alt text', () => {
	const wrapOf = (text: string) => parseImageLinkAt(text, 0)!.layout.wrap;
	// Obsidian trims the alt text: spaces at its start, and at its end when no size follows.
	assert.equal(wrapOf('![[x.png| wrap-left|60]]'), 'left');
	assert.equal(wrapOf('![[x.png|\twrap-left|60]]'), 'left');
	assert.equal(wrapOf('![[x.png|wrap-left ]]'), 'left');
	assert.equal(wrapOf('![[x.png|wrap-left| 60]]'), 'left');
	assert.equal(wrapOf('![[x.png|wrap-left|60 ]]'), 'left');
	assert.equal(wrapOf('![ wrap-left|60](x.png)'), 'left');
	assert.equal(wrapOf('![wrap-left ](x.png)'), 'left');
	assert.equal(wrapOf('![[x.png||wrap-right]]'), 'right');
	// Any other space stays in the alt text, and Live Preview draws the image in line.
	assert.equal(wrapOf('![[x.png|wrap-left |60]]'), 'none');
	assert.equal(wrapOf('![[x.png| wrap-left |60]]'), 'none');
	assert.equal(wrapOf('![[x.png|A caption | wrap-left|90]]'), 'none');
	assert.equal(wrapOf('![[x.png|A caption| wrap-left]]'), 'none');
	assert.equal(wrapOf('![wrap-left |60](x.png)'), 'none');
	assert.equal(wrapOf('![[x.png|Wrap-Left|60]]'), 'none');
	assert.equal(parseImageLinkAt('![[x.png|wrap-left|gap-8 |60]]', 0)!.layout.gap, 16);
	assert.equal(parseImageLinkAt('![[x.png|wrap-left| gap-8]]', 0)!.layout.gap, 16);
	assert.equal(parseImageLinkAt('![[x.png|wrap-left|gap-8 ]]', 0)!.layout.gap, 8);
});

test('segments with spaces that are not tokens stay where they are', () => {
	assert.equal(apply('![[x.png| wrap-left |60]]', L('right')), '![[x.png| wrap-left |wrap-right|60]]');
	assert.equal(
		apply('![[x.png|A caption | wrap-left|wrap-left|90]]', L('none')),
		'![[x.png|A caption | wrap-left|90]]',
	);
	// Tokens Obsidian trims into place are replaced like any other.
	assert.equal(apply('![[x.png| wrap-left|60]]', L('right')), '![[x.png|wrap-right|60]]');
	assert.equal(apply('![[x.png|cap|wrap-left ]]', L('none')), '![[x.png|cap]]');
	assert.equal(apply('![ wrap-block|60](x.png)', L('left', 8)), '![wrap-left|gap-8|60](x.png)');
});

// Every name an object inherits ("constructor", "toString", "__proto__", "hasOwnProperty" ...).
const PROTOTYPE_NAMES = Object.getOwnPropertyNames(Object.prototype);

test('a caption named like an inherited object member is caption text, not a token', () => {
	assert.ok(PROTOTYPE_NAMES.includes('__proto__') && PROTOTYPE_NAMES.includes('constructor'));
	for (const name of PROTOTYPE_NAMES) {
		assert.equal(isLayoutToken(name), false, name);
		assert.deepEqual(layoutFromSegments([name]), L('none'), name);
		assert.deepEqual(layoutFromSegments(['wrap-right', name, 'gap-8']), L('right', 8), name);
		const wiki = `![[square.png|${name}|200]]`;
		assert.deepEqual(parseImageLinkAt(wiki, 0)!.layout, L('none'), name);
		assert.equal(apply(wiki, L('left')), `![[square.png|${name}|wrap-left|200]]`, name);
		assert.equal(apply(wiki, L('left', 24)), `![[square.png|${name}|wrap-left|gap-24|200]]`, name);
		assert.equal(apply(wiki, L('none')), wiki, name);
		assert.equal(apply(`![[square.png|${name}|wrap-right|200]]`, L('none')), wiki, name);
		const md = `![${name}|200](square.png)`;
		assert.deepEqual(parseImageLinkAt(md, 0)!.layout, L('none'), name);
		assert.equal(apply(md, L('right')), `![${name}|wrap-right|200](square.png)`, name);
		// An alt text as Reading view has it.
		assert.deepEqual(layoutFromSegments(`${name}|wrap-left`.split('|')), L('left'), name);
	}
});

test('isExternalTarget: a URL with a scheme, not a file in the vault', () => {
	for (const t of ['https://example.com/a.png', 'http://127.0.0.1:8811/pic.png', 'data:image/png;base64,AAAA', 'file:///Users/a.png', ' HTTPS://x.org/a.png']) {
		assert.equal(isExternalTarget(t), true, t);
	}
	for (const t of ['photo.png', 'images/a b.png', 'C:/pictures/a.png', 'my%20photo.png']) {
		assert.equal(isExternalTarget(t), false, t);
	}
});
