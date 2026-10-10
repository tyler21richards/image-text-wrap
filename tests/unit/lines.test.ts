import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanLines, dropTargets, isPlainLine, opensOrCloses } from '../../src/markdown/lines.ts';
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
