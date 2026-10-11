import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanLines, dropTargets, isPlainLine, lastLineAffected, opensOrCloses } from '../../src/markdown/lines.ts';
import { LINE_POOL, pick, random } from './markdown-samples.ts';

const scan = (text: string) => scanLines(text.split('\n'));
const targets = (text: string) => dropTargets(text.split('\n'));

test('frontmatter, headings, paragraphs and lists', () => {
	const text = [
		'---', // 0
		'tags: [a]', // 1
		'---', // 2
		'# Title', // 3
		'Intro line right under the heading.', // 4
		'second line of intro', // 5
		'', // 6
		'- item', // 7
		'  continued', // 8
		'- item two', // 9
		'', // 10
		'- after a blank, same list', // 11
		'', // 12
		'Paragraph.', // 13
		'## Heading glued under a paragraph', // 14
	].join('\n');
	assert.deepEqual(targets(text), [3, 4, 7, 13, 14, 15]);
	const info = scan(text);
	assert.equal(info[1]!.context, 'frontmatter');
	assert.equal(info[8]!.kind, 'indented');
});

test('code, math and comments are never inside targets, but their starts are', () => {
	const text = [
		'Text.', // 0
		'', // 1
		'```js', // 2
		'# not a heading', // 3
		'', // 4
		'not a paragraph', // 5
		'```', // 6
		'After code.', // 7
		'', // 8
		'$$', // 9
		'x^2', // 10
		'$$', // 11
		'', // 12
		'%%', // 13
		'hidden', // 14
		'%%', // 15
		'Visible.', // 16
	].join('\n');
	assert.deepEqual(targets(text), [0, 2, 7, 9, 16, 17]);
	assert.equal(scan(text)[3]!.context, 'code');
	assert.equal(scan(text)[10]!.context, 'math');
	assert.equal(scan(text)[14]!.context, 'comment');
});

test('quotes, callouts and tables are one block each', () => {
	const text = [
		'> quote', // 0
		'> more', // 1
		'', // 2
		'> [!note] Callout', // 3
		'> body', // 4
		'', // 5
		'| a | b |', // 6
		'| --- | --- |', // 7
		'| 1 | 2 |', // 8
		'', // 9
		'---', // 10 (rule after blank)
		'Para', // 11
		'---', // 12 (setext underline, not a rule)
	].join('\n');
	assert.deepEqual(targets(text), [0, 3, 6, 10, 11, 13]);
	assert.equal(scan(text)[12]!.kind, 'setext-underline');
	assert.equal(scan(text)[7]!.kind, 'table');
});

test('a note ending inside a fence has no end target', () => {
	assert.deepEqual(targets('Text\n\n```\ncode'), [0, 2]);
});

test('unclosed frontmatter is treated as text', () => {
	const info = scan('---\nnot closed');
	assert.equal(info[0]!.context, 'text');
});

test('inline $$ math does not open a block', () => {
	const info = scan('$$x$$ is inline\nnext');
	assert.equal(info[0]!.context, 'text');
	assert.equal(info[1]!.context, 'text');
});

test('plain lines: only ordinary text', () => {
	const plain = ['Text.', 'x', '![wrap-right](x.png)', 'Text ![[b.png]] and more', '...more', 'Dollar $5 and 5%'];
	for (const line of plain) assert.equal(isPlainLine(line), true, line);
	const notPlain = [
		'',
		'   ',
		'---',
		'...',
		'```js',
		'~~~',
		'$$',
		'%%',
		'<!--',
		'-->',
		'| a | b |',
		':-:',
		'# Heading',
		'> quote',
		'- item',
		'1. item',
		'  indented',
		'***',
		'===',
		'--',
		'![[a.png|wrap-left|60]]', // its pipes could make it a table row
	];
	for (const line of notPlain) assert.equal(isPlainLine(line), false, line);
});

const kinds = (text: string) => scan(text).map((info) => `${info.kind}${info.startsBlock ? '*' : ''}`);

test('a line that continues a list item, quote or footnote without its marker belongs to it', () => {
	assert.deepEqual(kinds(['- item', '![[a.png|wrap-left|60]]', 'more', '', 'After.'].join('\n')), ['list*', 'list', 'list', 'blank', 'paragraph*']);
	assert.deepEqual(kinds(['> quote', '![[a.png|wrap-left|60]]', '', 'After.'].join('\n')), ['quote*', 'quote', 'blank', 'paragraph*']);
	assert.deepEqual(kinds(['[^1]: note', 'lazy ![[a.png|wrap-left|60]]', '', '![[a.png|wrap-left|60]]'].join('\n')), ['footnote*', 'footnote', 'blank', 'paragraph*']);
	// Reading view (1.14.4) also continues an empty list item and a heading in a quote.
	assert.deepEqual(kinds('-\n![[a.png|wrap-left|60]]'), ['list*', 'list']);
	assert.deepEqual(kinds('> # Heading\n![[a.png|wrap-left|60]]'), ['quote*', 'quote']);
	// An indented line after a quote or footnote line continues it too; in a list it stays indented.
	assert.deepEqual(kinds('> quote\n    more'), ['quote*', 'quote']);
	assert.deepEqual(kinds('[^1]: note\n    more'), ['footnote*', 'footnote']);
	assert.deepEqual(kinds('- item\n  more\nlazy'), ['list*', 'indented', 'list']);
	// A lazy line keeps the list going: the next item continues it.
	assert.deepEqual(kinds('- a\nlazy\n- b'), ['list*', 'list', 'list']);
	// Blocks that interrupt a paragraph end it.
	assert.deepEqual(kinds('- item\n# Heading\ntext'), ['list*', 'heading*', 'paragraph*']);
	assert.deepEqual(kinds('> quote\n---'), ['quote*', 'hr*']);
	assert.deepEqual(kinds('- item\n```\ncode\n```'), ['list*', 'fence*', 'inside', 'fence']);
});

test('a footnote definition, unless it is glued under a paragraph', () => {
	assert.deepEqual(kinds('Text.\n\n[^1]: ![[a.png|wrap-left|60]] note'), ['paragraph*', 'blank', 'footnote*']);
	// Reading view draws this one as paragraph text (Live Preview still marks it a footnote).
	assert.deepEqual(kinds('Text right above.\n[^1]: ![[a.png|wrap-left|60]] note'), ['paragraph*', 'paragraph']);
	assert.equal(isPlainLine('[^1]: note'), false);
});

test('one to three spaces before a line change nothing outside a list', () => {
	for (const pad of [' ', '  ', '   ']) {
		assert.deepEqual(kinds(`Intro.\n\n${pad}![[a.png|wrap-left|60]]\nText.`), ['paragraph*', 'blank', 'paragraph*', 'paragraph'], pad);
		assert.deepEqual(kinds(`Intro.\n\n${pad}# Title\n${pad}- item`), ['paragraph*', 'blank', 'heading*', 'list*'], pad);
	}
	// Four spaces or a tab make indented code after a blank line, and continue a paragraph right under one.
	assert.deepEqual(kinds('Intro.\n\n    code\n\tcode'), ['paragraph*', 'blank', 'indented', 'indented']);
	assert.deepEqual(kinds('Paragraph.\n    ![[a.png|wrap-left|60]]'), ['paragraph*', 'paragraph']);
	// In a list an indented line continues the item, whatever its depth, unless a blank line comes before
	// it and it is indented less than the item's text: then the list has ended.
	assert.deepEqual(kinds('- item\n ![[a.png|wrap-left|60]]'), ['list*', 'indented']);
	assert.deepEqual(kinds('- item\n\n  ![[a.png|wrap-left|60]]'), ['list*', 'blank', 'indented']);
	assert.deepEqual(kinds('- item\n\n ![[a.png|wrap-left|60]]\nText.'), ['list*', 'blank', 'paragraph*', 'paragraph']);
	assert.deepEqual(kinds('1. item\n\n  ![[a.png|wrap-left|60]]'), ['list*', 'blank', 'paragraph*']);
	assert.deepEqual(kinds('10. item\n\n   ![[a.png|wrap-left|60]]'), ['list*', 'blank', 'paragraph*']);
	assert.deepEqual(kinds('-   item\n\n   ![[a.png|wrap-left|60]]'), ['list*', 'blank', 'paragraph*']);
	assert.deepEqual(targets('Intro.\n\n ![[a.png|wrap-left|60]]\nText.'), [0, 2, 4]);
});

test('lastLineAffected: to the next blank line, then over the indented lines after it', () => {
	const lines = ['- a', 'lazy', 'more', '', '', '  indented', ' x', '', 'Next.', 'After.'];
	const last = (n: number) => lastLineAffected(n, lines.length - 1, (k) => lines[k]!);
	assert.equal(last(0), 8);
	assert.equal(last(5), 8);
	assert.equal(last(8), 9);
	assert.equal(last(9), 9);
});

test('lines that can open or close code, math, comments or frontmatter', () => {
	for (const line of ['```js', '  ~~~', '$$', 'a $$x$$ b', '%%', 'text %% c %%', '<!--', '-->']) {
		assert.equal(opensOrCloses(line, false), true, line);
	}
	assert.equal(opensOrCloses('---', false), false);
	assert.equal(opensOrCloses('---', true), true);
	assert.equal(opensOrCloses('... ', true), true);
	assert.equal(opensOrCloses('Text with `code` and $x$.', true), false);
});

test('changing a plain line into another never changes how the other lines are read', () => {
	const next = random(7);
	const plain = LINE_POOL.filter(isPlainLine);
	for (let round = 0; round < 3000; round++) {
		const lines = Array.from({ length: 1 + Math.floor(next() * 12) }, () => pick(next, LINE_POOL));
		const at = Math.floor(next() * lines.length);
		if (!isPlainLine(lines[at]!)) lines[at] = pick(next, plain);
		const changed = lines.slice();
		changed[at] = pick(next, plain);
		const before = scanLines(lines);
		const after = scanLines(changed);
		const what = `${JSON.stringify(lines)}: line ${at} becomes ${JSON.stringify(changed[at])}`;
		before.forEach((info, n) => {
			if (n !== at) assert.deepEqual(after[n], info, what);
		});
		assert.equal(after[at]!.context, before[at]!.context, what);
	}
});
