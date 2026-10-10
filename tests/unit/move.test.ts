import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChangeSet } from '@codemirror/state';
import { applyChanges, canGlueAbove, dropZones, planMove, type MovePlan } from '../../src/markdown/move.ts';
import { findImageLinks } from '../../src/grammar.ts';
import { dropTargets, scanLines } from '../../src/markdown/lines.ts';

/**
 * Moves the `nth` image link on line `line` of `text` in front of line `target`.
 * `link` replaces the link text (a side change); by default the link is kept as written.
 */
function move(text: string, line: number, target: number, opts: { link?: string; wrapped?: boolean; nth?: number } = {}) {
	const lines = text.split('\n');
	const found = findImageLinks(lines[line]!)[opts.nth ?? 0];
	assert.ok(found, `no image link on line ${line}`);
	const link = opts.link ?? lines[line]!.slice(found.from, found.to);
	const wrapped = opts.wrapped ?? found.layout.wrap !== 'none';
	const plan = planMove(lines, { line, from: found.from, to: found.to, target, link, wrapped });
	return { plan, lines, text };
}

/** Checks the plan's changes are well formed and produce the planned text, and returns that text. */
function result(plan: MovePlan | null, text: string): string {
	assert.ok(plan, 'expected a plan');
	let last = -1;
	for (const c of plan.changes) {
		assert.ok(c.from >= last && c.from <= c.to && c.to <= text.length, 'changes ascending and inside the note');
		last = c.to;
	}
	const out = applyChanges(text, plan.changes);
	assert.equal(out, plan.lines.join('\n'));
	return out;
}

function moved(text: string, line: number, target: number, opts: { link?: string; wrapped?: boolean; nth?: number } = {}) {
	const { plan } = move(text, line, target, opts);
	const out = result(plan, text);
	assert.ok(!/\n[ \t]*\n[ \t]*\n/.test(out), `no double blank line in:\n${out}`);
	return { out, plan: plan! };
}

const join = (...lines: string[]) => lines.join('\n');

test('an unwrapped image moves down into a paragraph of its own', () => {
	const text = join('P1', '', '![[a.png]]', '', 'P2', '', 'P3');
	const { out, plan } = moved(text, 2, 6);
	assert.equal(out, join('P1', '', 'P2', '', '![[a.png]]', '', 'P3'));
	assert.equal(plan.changes.length, 2, 'one removal and one insertion');
});

test('an unwrapped image moves up to the start of the note', () => {
	const text = join('P1', '', 'P2', '', '![[a.png|300]]', '', 'P3');
	assert.equal(moved(text, 4, 0).out, join('![[a.png|300]]', '', 'P1', '', 'P2', '', 'P3'));
});

test('dropping where the image already is plans nothing', () => {
	const text = join('P1', '', '![[a.png]]', '', 'P2', '', 'P3');
	// Its own line, and the block right after its own paragraph, are the same place.
	for (const target of [2, 4]) {
		const { plan } = move(text, 2, target);
		assert.deepEqual(plan?.changes, [], `target ${target}`);
	}
	const glued = join('P1', '', '![[a.png|wrap-left]]', 'Text A', '', 'P2');
	assert.deepEqual(move(glued, 2, 2).plan?.changes, []);
});

test('a wrapped image is glued above the block it moves to', () => {
	const text = join('P1', '', '![[a.png|wrap-left|300]]', 'Text A', '', 'P2', 'more P2');
	assert.equal(moved(text, 2, 5).out, join('P1', '', 'Text A', '', '![[a.png|wrap-left|300]]', 'P2', 'more P2'));
	// Up: in front of the first paragraph.
	assert.equal(moved(text, 2, 0).out, join('![[a.png|wrap-left|300]]', 'P1', '', 'Text A', '', 'P2', 'more P2'));
});

test('a side change in the same place rewrites only the link', () => {
	const text = join('P1', '', '![[a.png|A caption|wrap-left|gap-24|300]]', 'Text A', '', 'P2');
	const link = '![[a.png|A caption|wrap-right|gap-24|300]]';
	const { out, plan } = moved(text, 2, 2, { link });
	assert.equal(out, join('P1', '', link, 'Text A', '', 'P2'));
	assert.equal(plan.changes.length, 1);
	const start = text.indexOf('![[');
	assert.deepEqual(plan.changes[0], { from: start, to: start + '![[a.png|A caption|wrap-left|gap-24|300]]'.length, insert: link });
});

test('a side change while moving writes the new side at the target', () => {
	const text = join('P1', '', '![[a.png|wrap-left]]', 'Text A', '', 'P2');
	assert.equal(moved(text, 2, 5, { link: '![[a.png|wrap-right]]' }).out, join('P1', '', 'Text A', '', '![[a.png|wrap-right]]', 'P2'));
});

test('end of the note: after one blank line, keeping a trailing newline only if there was one', () => {
	const text = join('P1', '', '![[a.png|wrap-left]]', 'Text A', '', 'P2');
	assert.equal(moved(text, 2, 6).out, join('P1', '', 'Text A', '', 'P2', '', '![[a.png|wrap-left]]'));
	const withNewline = `${text}\n`;
	assert.equal(moved(withNewline, 2, 7).out, `${join('P1', '', 'Text A', '', 'P2', '', '![[a.png|wrap-left]]')}\n`);
	// Several blank lines at the end: the image goes after the first of them.
	const blanks = join('P1', '', '![[a.png]]', '', 'P2', '', '', '');
	assert.equal(moved(blanks, 2, 8).out, join('P1', '', 'P2', '', '![[a.png]]', '', ''));
});

test('dropping at the end of the note when the image is already last plans nothing', () => {
	assert.deepEqual(move(join('P1', '', '![[a.png]]'), 2, 3).plan?.changes, []);
	assert.deepEqual(move(join('P1', '', '![[a.png]]', ''), 2, 4).plan?.changes, []);
});

test('no leading blank line is left when the first line moves away', () => {
	const glued = join('![[a.png|wrap-left]]', 'Text', '', 'P2');
	assert.equal(moved(glued, 0, 3).out, join('Text', '', '![[a.png|wrap-left]]', 'P2'));
	const own = join('![[a.png]]', '', 'P1', '', 'P2');
	assert.equal(moved(own, 0, 4).out, join('P1', '', '![[a.png]]', '', 'P2'));
});

test('no trailing blank line is left when the last line moves away', () => {
	const text = join('P1', '', 'P2', '', '![[a.png]]');
	assert.equal(moved(text, 4, 0).out, join('![[a.png]]', '', 'P1', '', 'P2'));
	const withNewline = join('P1', '', 'P2', '', '![[a.png]]', '');
	assert.equal(moved(withNewline, 4, 2).out, join('P1', '', '![[a.png]]', '', 'P2', ''));
});

test('an image sharing its line with text: only the link and one space go', () => {
	const text = join('Before ![[a.png]] after', '', 'P2');
	const { out, plan } = moved(text, 0, 2);
	assert.equal(out, join('Before after', '', '![[a.png]]', '', 'P2'));
	assert.equal(plan.changes.length, 2);
	assert.equal(moved(join('Before ![[a.png]]', '', 'P2'), 0, 2).out, join('Before', '', '![[a.png]]', '', 'P2'));
	// At the start of the line, so the text cannot become indented code.
	assert.equal(moved(join('P0', '', '![[a.png]]     text', '', 'P2'), 2, 4).out, join('P0', '', 'text', '', '![[a.png]]', '', 'P2'));
	// Moving it to the start of its own block puts it on a line of its own.
	assert.equal(moved(join('![[a.png|wrap-right]] Text here', '', 'P2'), 0, 0).out, join('![[a.png|wrap-right]]', 'Text here', '', 'P2'));
});

test('two images on one line: only the dragged one moves', () => {
	const text = join('![[a.png]] ![[a.png]]', '', 'P2');
	assert.equal(moved(text, 0, 2, { nth: 1 }).out, join('![[a.png]]', '', '![[a.png]]', '', 'P2'));
});

test('the same image embedded twice: only the dragged copy moves', () => {
	const text = join('![[a.png|wrap-left]]', 'One', '', '![[a.png|wrap-left]]', 'Two', '', 'Three');
	const { out, plan } = moved(text, 3, 6);
	assert.equal(out, join('![[a.png|wrap-left]]', 'One', '', 'Two', '', '![[a.png|wrap-left]]', 'Three'));
	const secondLine = text.indexOf('\n\n') + 2;
	assert.ok(plan.changes.every((c) => c.from >= secondLine), 'the first copy is not touched');
});

test('glued above headings, quotes, callouts, code fences and bullet lists', () => {
	const head = ['P1', '', '![[a.png|wrap-left]]', 'Text', ''];
	for (const block of ['# Heading', '> quote', '> [!note] Callout', '```js', '- item', '* item', '1. item', '1) item']) {
		const rest = block === '```js' ? [block, 'code', '```'] : [block];
		const text = join(...head, ...rest);
		assert.equal(moved(text, 2, 5).out, join('P1', '', 'Text', '', '![[a.png|wrap-left]]', ...rest), block);
	}
});

test('a blank line is kept after the image where gluing would change the Markdown', () => {
	const head = ['P1', '', '![[a.png|wrap-left]]', 'Text', ''];
	const cases: string[][] = [
		['| a | b |', '| --- | --- |', '| 1 | 2 |'], // a table needs a blank line before it
		['---'], // glued, a rule would underline the image as a heading
		['***'],
		['$$', 'x^2', '$$'],
		['2. starts at two'], // only lists starting at 1 interrupt a paragraph
		['Title', '==='], // a setext heading would swallow the image
		['Title', 'second line', '---'],
		['<div>html</div>'],
		['[ref]: https://example.com'],
		['[^1]: A footnote.'],
	];
	for (const rest of cases) {
		const text = join(...head, ...rest);
		assert.equal(moved(text, 2, 5).out, join('P1', '', 'Text', '', '![[a.png|wrap-left]]', '', ...rest), rest[0]);
	}
});

test('a heading glued under a paragraph gets a blank line before the image', () => {
	const text = join('![[a.png|wrap-left]]', 'Text', '', 'Para', '## Heading', 'After');
	assert.equal(moved(text, 0, 4).out, join('Text', '', 'Para', '', '![[a.png|wrap-left]]', '## Heading', 'After'));
});

test('the line after a heading, and after frontmatter, gets a blank line before the image', () => {
	const text = join('---', 'tags: [a]', '---', 'First', '', '# H', 'Under the heading', '', '![[a.png]]');
	assert.equal(moved(text, 8, 3).out, join('---', 'tags: [a]', '---', '', '![[a.png]]', '', 'First', '', '# H', 'Under the heading'));
	assert.equal(moved(text, 8, 6).out, join('---', 'tags: [a]', '---', 'First', '', '# H', '', '![[a.png]]', '', 'Under the heading'));
});

test('an unwrapped image always gets a paragraph of its own', () => {
	const text = join('P1', '', '![[a.png]]', '', '# Heading', '', '- item');
	assert.equal(moved(text, 2, 6).out, join('P1', '', '# Heading', '', '![[a.png]]', '', '- item'));
	assert.equal(moved(text, 2, 4).out, text.replace('![[a.png]]\n\n# Heading', '![[a.png]]\n\n# Heading'));
});

test('top and bottom images are glued like wrapped ones', () => {
	const text = join('P1', '', '![[a.png|wrap-block|360]]', 'Text', '', 'P2');
	assert.equal(moved(text, 2, 5).out, join('P1', '', 'Text', '', '![[a.png|wrap-block|360]]', 'P2'));
});

test('Markdown image links move the same way', () => {
	const text = join('P1', '', '![A caption|wrap-right|120](photo.png)', 'Text', '', 'P2');
	assert.equal(moved(text, 2, 5).out, join('P1', '', 'Text', '', '![A caption|wrap-right|120](photo.png)', 'P2'));
});

test('targets inside code, tables, list items, quotes and frontmatter are refused', () => {
	const text = join(
		'---', // 0
		'title: x', // 1
		'---', // 2
		'![[a.png|wrap-left]]', // 3
		'Text', // 4
		'', // 5
		'```', // 6
		'code', // 7
		'```', // 8
		'', // 9
		'| a | b |', // 10
		'| --- | --- |', // 11
		'| 1 | 2 |', // 12
		'', // 13
		'- item', // 14
		'- second item', // 15
		'  - nested', // 16
		'', // 17
		'> quote', // 18
		'> more quote', // 19
		'', // 20
		'Last', // 21
	);
	const lines = text.split('\n');
	assert.deepEqual(dropTargets(lines), [3, 6, 10, 14, 18, 21, 22]);
	for (const target of [0, 1, 2, 4, 5, 7, 8, 11, 12, 15, 16, 19, 20]) {
		assert.equal(move(text, 3, target).plan, null, `target ${target}`);
	}
	for (const target of [6, 10, 14, 18, 21, 22]) assert.ok(move(text, 3, target).plan, `target ${target}`);
});

test('a broken request is refused', () => {
	const lines = ['P1', '', '![[a.png]]'];
	assert.equal(planMove(lines, { line: 5, from: 0, to: 3, target: 0, link: 'x', wrapped: false }), null);
	assert.equal(planMove(lines, { line: 2, from: 4, to: 2, target: 0, link: 'x', wrapped: false }), null);
	assert.equal(planMove(lines, { line: 2, from: 0, to: 99, target: 0, link: 'x', wrapped: false }), null);
});

test('a note made of nothing but the image', () => {
	assert.deepEqual(move('![[a.png]]', 0, 0).plan?.changes, []);
	assert.deepEqual(move('![[a.png]]', 0, 1).plan?.changes, []);
});

test('moving to every target of the fixture-like note keeps every other line', () => {
	const text = join(
		'# Title',
		'',
		'Intro.',
		'',
		'![[landscape.png|wrap-left|300]]',
		'A painter rented the cottage.',
		'',
		'Rain here.',
		'',
		'## A heading',
		'',
		'- A list item',
		'\t- nested',
		'- last',
		'',
		'> A quote',
		'',
		'> [!note] A callout',
		'> body',
		'',
		'---',
		'',
		'| Place | Picture |',
		'| --- | --- |',
		'| Harbour | ![[square.png\\|60]] |',
		'',
		'```js',
		'x',
		'```',
		'',
		'$$',
		'h',
		'$$',
		'',
		'Filler.',
	);
	const lines = text.split('\n');
	const infos = scanLines(lines);
	const targets = dropTargets(lines, infos);
	for (const target of targets) {
		const { plan } = move(text, 4, target);
		const out = result(plan, text);
		const kept = (s: string) => s.split('\n').filter((l) => l.trim() && !l.startsWith('![[landscape'));
		assert.deepEqual(kept(out), kept(text), `target ${target}: other lines unchanged and in order`);
		assert.equal(out.split('![[landscape.png|wrap-left|300]]').length, 2, `target ${target}: the link appears once`);
		assert.ok(!/\n[ \t]*\n[ \t]*\n/.test(out), `target ${target}: no double blank line`);
		// Nothing (same place: its own line, or the paragraph it is glued to) or one removal plus one insertion.
		const same = target === 4;
		assert.equal(plan!.changes.length, same ? 0 : 2, `target ${target}: change count`);
		assert.equal(plan!.changes.filter((c) => c.insert === '').length, same ? 0 : 1, `target ${target}: one removal`);
	}
});

test('drop zones: nothing is offered inside code, tables, quotes, later list items or frontmatter', () => {
	const lines = [
		'---', // 0 frontmatter
		'a: 1', // 1
		'---', // 2
		'Para line one', // 3 start
		'para line two', // 4 continuation: snaps to the nearest start
		'', // 5 gap before a block
		'```', // 6 code start
		'code', // 7
		'', // 8 blank inside code
		'```', // 9 closing fence
		'', // 10
		'- one', // 11 list start
		'- two', // 12 later item
		'', // 13 blank between items
		'- three', // 14
		'  nested', // 15
		'', // 16
		'> quote', // 17 quote start
		'> more', // 18
		'', // 19
		'| a | b |', // 20 table start
		'| --- | --- |', // 21
		'| 1 | 2 |', // 22
		'', // 23
		'Title', // 24
		'===', // 25 setext underline: part of a heading paragraph
		'', // 26
		'$$', // 27 math start
		'x', // 28
		'$$', // 29
		'', // 30 last gap before the end of the note
	];
	const zones = dropZones(lines);
	const yes = zones.flatMap((z, i) => (z ? [i] : []));
	assert.deepEqual(yes, [3, 4, 5, 6, 10, 11, 16, 17, 19, 20, 23, 24, 25, 26, 27, 30]);
});

test('a cursor at the start of the target block stays with its text', () => {
	const text = join('P1', '', '![[a.png|wrap-left]]', 'Text A', '', 'P2 starts here', '', 'P3');
	for (const [target, wrapped] of [
		[5, true],
		[5, false],
		[0, true],
		[8, true],
	] as const) {
		const link = wrapped ? '![[a.png|wrap-left]]' : '![[a.png]]';
		const source = wrapped ? text : text.replace('![[a.png|wrap-left]]', link);
		const plan = planMove(source.split('\n'), { line: 2, from: 0, to: link.length, target, link, wrapped });
		assert.ok(plan && plan.changes.length === 2);
		const changes = ChangeSet.of(plan.changes, source.length);
		const out = plan.lines.join('\n');
		const cursor = source.indexOf('P2 starts here');
		assert.equal(out.slice(changes.mapPos(cursor, -1)).slice(0, 14), 'P2 starts here', `target ${target}`);
	}
});

test('canGlueAbove follows the kind of line', () => {
	const lines = ['# H', '- a', '2. b', '> q', '| a |', '---', 'para', '```'];
	const infos = scanLines(lines);
	assert.equal(canGlueAbove(lines, infos, 0), true);
	assert.equal(canGlueAbove(lines, infos, 6), true);
	assert.equal(canGlueAbove(lines, infos, 99), false);
});
