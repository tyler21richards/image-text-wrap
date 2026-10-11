import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EditorState, type ChangeSpec } from '@codemirror/state';
import { lineClassField } from '../../src/live-preview/line-classes.ts';
import { LINE_POOL, pick, random } from './markdown-samples.ts';

const stateOf = (text: string) => EditorState.create({ doc: text, extensions: [lineClassField] });

/** "line number: classes" for every decorated line, and whether the editor gets its class. */
function classes(state: EditorState): { hasWrap: boolean; lines: string[] } {
	const { hasWrap, decorations } = state.field(lineClassField);
	const lines: string[] = [];
	decorations.between(0, state.doc.length, (from, _to, deco) => {
		lines.push(`${state.doc.lineAt(from).number}: ${String(deco.spec.class)}`);
	});
	return { hasWrap, lines };
}

test('a line holding only a wrapped image gets its classes', () => {
	const state = stateOf(['Intro.', '', '![[a.png|wrap-left|60]]', 'Text beside.', '', '![x|wrap-block|gap-8](b.png)', 'Below.'].join('\n'));
	assert.deepEqual(classes(state), {
		hasWrap: true,
		lines: ['3: itw-image-line itw-image-line-left', '6: itw-image-line itw-image-line-block itw-gap-8'],
	});
});

test('lines in code, comments, math, frontmatter, lists, quotes, tables and headings keep their height (lists and quotes are marked to stay in line)', () => {
	const text = [
		'---', // 1
		'cover: "![[a.png|wrap-left]]"', // 2
		'---', // 3
		'```markdown', // 4
		'![[photo.png|wrap-left|300]]', // 5
		'![A caption|wrap-block|300](photo.png)', // 6
		'```', // 7
		'', // 8
		'    ![[a.png|wrap-right|200]]', // 9 indented code
		'', // 10
		'<!--', // 11
		'![[a.png|wrap-right|200]]', // 12
		'-->', // 13
		'%%', // 14
		'![[a.png|wrap-left|200]]', // 15
		'%%', // 16
		'$$', // 17
		'![[a.png|wrap-left|200]]', // 18
		'$$', // 19
		'- ![[a.png|wrap-left|60]]', // 20
		'> ![[a.png|wrap-left|60]]', // 21
		'# ![[a.png|wrap-left|60]]', // 22
		'', // 23
		'![[a.png|wrap-left|60]]', // 24 a table header: the next line is a delimiter row
		'| --- |', // 25
		'', // 26
		'![[a.png|wrap-right|120]]', // 27 the one real wrapped image
		'Text beside it.', // 28
	].join('\n');
	assert.deepEqual(classes(stateOf(text)).lines, ['20: itw-keep-in-line', '21: itw-keep-in-line', '27: itw-image-line itw-image-line-right']);
});

/** "from-to: class" for every decoration that covers part of a line (offsets in the note). */
function marks(state: EditorState): string[] {
	const out: string[] = [];
	state.field(lineClassField).decorations.between(0, state.doc.length, (from, to, deco) => {
		if (to > from) out.push(`${from}-${to}: ${String(deco.spec.class)}`);
	});
	return out;
}

test('a line of several images all wrapped left or right takes no height', () => {
	const two = (a: string, b: string) => classes(stateOf(`Intro.\n\n${a} ${b}\nText.`)).lines;
	assert.deepEqual(two('![[a.png|wrap-left|60]]', '![[b.png|wrap-right|60]]'), ['3: itw-image-line itw-image-line-multi']);
	assert.deepEqual(two('![[a.png|wrap-left|60]]', '![x|wrap-left|gap-8](b.png)'), ['3: itw-image-line itw-image-line-multi']);
	// Not when one of them is in line or top and bottom, or text shares the line.
	assert.deepEqual(two('![[a.png|wrap-left|60]]', '![[b.png|60]]'), []);
	assert.deepEqual(two('![[a.png|wrap-left|60]]', '![[b.png|wrap-block|60]]'), []);
	assert.deepEqual(two('![[a.png|wrap-left|60]]', 'and text'), []);
});

test('a remote or data-URI image wrapped on a line with other content gets a class around it', () => {
	const url = 'https://example.com/a.png';
	const data = 'data:image/png;base64,AAAA';
	const at = (text: string, needle: string) => `${text.indexOf(needle)}-${text.indexOf(needle) + needle.length}`;
	let text = `Intro.\n\nStart ![wrap-left|120](${url}) and more text.`;
	assert.deepEqual(marks(stateOf(text)), [`${at(text, `![wrap-left|120](${url})`)}: itw-inline-left`]);
	assert.deepEqual(classes(stateOf(text)).lines, ['3: itw-inline-left']);
	text = `![wrap-right|gap-8](${data}) text after it`;
	assert.deepEqual(marks(stateOf(text)), [`${at(text, `![wrap-right|gap-8](${data})`)}: itw-inline-right itw-gap-8`]);
	text = `Text ![wrap-block](${url})`;
	assert.deepEqual(marks(stateOf(text)), [`${at(text, `![wrap-block](${url})`)}: itw-inline-block`]);
	// On a line of wrapped images only, beside the line class.
	text = `![[a.png|wrap-left|60]] ![wrap-right|60](${url})`;
	assert.deepEqual(classes(stateOf(text)).lines, ['1: itw-image-line itw-image-line-multi', '1: itw-inline-right']);
	// Alone on its line the line class covers it; a local image floats by its own alt text; an image in
	// line needs nothing; and in a list item the picture stays in line.
	assert.deepEqual(marks(stateOf(`![wrap-left|120](${url})\nText.`)), []);
	assert.deepEqual(classes(stateOf(`![wrap-left|120](${url})\nText.`)).lines, ['1: itw-image-line itw-image-line-left']);
	assert.deepEqual(marks(stateOf('Start ![[a.png|wrap-left|120]] and more.')), []);
	assert.deepEqual(marks(stateOf(`Start ![120](${url}) and more.`)), []);
	assert.deepEqual(classes(stateOf(`- Start ![wrap-left|120](${url}) and more.`)).lines, ['1: itw-keep-in-line']);
});

test('a wrapped image line indented by one to three spaces gets its class; in a list it does not', () => {
	for (const pad of [' ', '  ', '   ']) {
		assert.deepEqual(classes(stateOf(`Intro.\n\n${pad}![[a.png|wrap-left|60]]\nText.`)).lines, ['3: itw-image-line itw-image-line-left'], pad);
	}
	assert.deepEqual(classes(stateOf('- item\n\n  ![[a.png|wrap-left|60]]\nText.')).lines, []);
	assert.deepEqual(classes(stateOf('- item\n\n ![[a.png|wrap-left|60]]\nText.')).lines, ['3: itw-image-line itw-image-line-left']);
});

test('a line that continues a list item, quote or footnote is marked to keep its picture in line', () => {
	const lines = (text: string) => classes(stateOf(text)).lines;
	assert.deepEqual(lines('- item\n![[a.png|wrap-left|60]]\nText.'), ['2: itw-keep-in-line']);
	assert.deepEqual(lines('> quote\n![[a.png|wrap-left|60]]\nText.'), ['2: itw-keep-in-line']);
	assert.deepEqual(lines('Intro.\n\n[^1]: ![[a.png|wrap-left|60]] note'), ['3: itw-keep-in-line']);
	assert.deepEqual(lines('Intro.\n\n[^1]: note\nmore ![[a.png|wrap-left|60]] text'), ['4: itw-keep-in-line']);
	// Glued under a paragraph a footnote is text, and its picture floats as Reading view draws it.
	assert.deepEqual(lines('Intro.\n[^1]: ![[a.png|wrap-left|60]] note'), []);
	// No wrapped image, no class.
	assert.deepEqual(lines('- item\n![[a.png|60]]'), []);
});

test('adding or removing a list marker above an image line re-reads it', () => {
	let state = stateOf(['Intro.', '', 'item', '![[a.png|wrap-left|60]]', 'Text.', '', 'End.'].join('\n'));
	assert.deepEqual(classes(state).lines, ['4: itw-image-line itw-image-line-left']);
	const at = state.doc.line(3).from;
	state = state.update({ changes: { from: at, insert: '- ' } }).state;
	assert.deepEqual(classes(state).lines, ['4: itw-keep-in-line']);
	state = state.update({ changes: { from: at, to: at + 2 } }).state;
	assert.deepEqual(classes(state).lines, ['4: itw-image-line itw-image-line-left']);
	// A list item's marker decides whether an indented line after a blank line still belongs to it.
	state = stateOf(['- item', '', '  ![[a.png|wrap-left|60]]', 'Text.'].join('\n'));
	assert.deepEqual(classes(state).lines, []);
	state = state.update({ changes: { from: 0, to: 1, insert: '1.' } }).state;
	assert.deepEqual(classes(state).lines, ['3: itw-image-line itw-image-line-left']);
});

test('typing right after a remote image keeps its class on the link only', () => {
	const url = 'https://example.com/a.png';
	const link = `![wrap-left|120](${url})`;
	let state = stateOf(`Start ${link} more.`);
	const end = state.doc.toString().indexOf(link) + link.length;
	state = state.update({ changes: { from: end, insert: 'xyz' } }).state;
	assert.deepEqual(marks(state), [`6-${6 + link.length}: itw-inline-left`]);
	state = state.update({ changes: { from: 6, insert: 'abc ' } }).state;
	assert.deepEqual(marks(state), [`10-${10 + link.length}: itw-inline-left`]);
});

test('links Obsidian does not draw as wrapped images give no line class', () => {
	for (const line of [
		'![a [b] c|wrap-right](images/tall.png)', // Live Preview draws no image
		'`![[a.png|wrap-left]]`',
		'%%![[a.png|wrap-left]]%%',
		'$![[a.png|wrap-left]]$',
		'![[a.png| wrap-left |60]]', // Live Preview draws it in line
		'![[a.png|A caption | wrap-left|90]]',
	]) {
		assert.deepEqual(classes(stateOf(`Intro.\n\n${line}\nText.`)).lines, [], line);
	}
	assert.deepEqual(classes(stateOf('Intro.\n\n![[a.png| wrap-left|60]]\nText.')).lines, ['3: itw-image-line itw-image-line-left']);
});

test('typing updates the classes like a fresh build (randomised edits)', () => {
	const next = random(11);
	const inserts = [...LINE_POOL.map((l) => `${l}\n`), ...LINE_POOL, '\n', 'a', ' ', '`', '$', '%%', '|', '!', '[[', ']]', '---\n', '```\n'];
	for (let round = 0; round < 300; round++) {
		const lines = Array.from({ length: 2 + Math.floor(next() * 14) }, () => pick(next, LINE_POOL));
		let state = stateOf(lines.join('\n'));
		for (let step = 0; step < 25; step++) {
			const len = state.doc.length;
			const changes: ChangeSpec[] = [];
			const count = next() < 0.15 ? 2 : 1;
			let floor = 0;
			for (let c = 0; c < count && floor <= len; c++) {
				const from = floor + Math.floor(next() * (len - floor + 1));
				const to = Math.min(len, from + (next() < 0.5 ? 0 : Math.floor(next() * 12)));
				changes.push({ from, to, insert: next() < 0.2 ? '' : pick(next, inserts) });
				floor = to + 1;
			}
			const before = state.doc.toString();
			state = state.update({ changes }).state;
			const fresh = stateOf(state.doc.toString());
			assert.deepEqual(classes(state), classes(fresh), `${JSON.stringify(before)} -> ${JSON.stringify(state.doc.toString())}`);
		}
	}
});

test('an edit that turns the line below into a table delimiter row re-reads the image line', () => {
	const doc = ['Intro.', '', '![[a.png|wrap-left|60]]', 'Text.', '', 'End.'].join('\n');
	const textAt = doc.indexOf('Text.');
	for (const row of ['| --- |', '---', ':-:']) {
		const state = stateOf(doc).update({ changes: { from: textAt, to: textAt + 5, insert: row } }).state;
		assert.deepEqual(classes(state).lines, [], row);
		const back = state.update({ changes: { from: textAt, to: textAt + row.length, insert: 'Text.' } }).state;
		assert.deepEqual(classes(back).lines, ['3: itw-image-line itw-image-line-left'], row);
	}
});

test('opening and closing a code block re-reads the lines after it', () => {
	let state = stateOf(['Intro.', '', '![[a.png|wrap-left|60]]', 'Text.'].join('\n'));
	state = state.update({ changes: { from: 0, insert: '```\n' } }).state;
	assert.deepEqual(classes(state).lines, []);
	state = state.update({ changes: { from: 0, to: 4 } }).state;
	assert.deepEqual(classes(state).lines, ['3: itw-image-line itw-image-line-left']);
});

test('typing in a plain paragraph keeps the decoration set it had', () => {
	let state = stateOf(['![[a.png|wrap-left|60]]', 'Text beside.', '', 'Another paragraph.'].join('\n'));
	const before = state.field(lineClassField);
	const at = state.doc.toString().indexOf('Another') + 3;
	state = state.update({ changes: { from: at, insert: 'xyz' } }).state;
	const after = state.field(lineClassField);
	assert.equal(after.hasWrap, true);
	assert.deepEqual(classes(state).lines, ['1: itw-image-line itw-image-line-left']);
	// Nothing to redo: the set is only mapped through the change.
	assert.equal(after.decorations.size, before.decorations.size);
	const plain = stateOf('Just text.\n\nMore text.');
	assert.equal(plain.update({ changes: { from: 2, insert: 'x' } }).state.field(lineClassField), plain.field(lineClassField));
});
