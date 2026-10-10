import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanLines, dropTargets } from '../../src/markdown/lines.ts';

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
