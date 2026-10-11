import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Text } from '@codemirror/state';
import { locateAt } from '../../src/edit/locate.ts';

const doc = (s: string) => Text.of(s.split('\n'));

test('finds the link that starts at a position, by position not by name', () => {
	const d = doc('Intro\n\n![[a.png|300]]\nText\n\n![[a.png|300]]\nMore');
	const second = d.toString().lastIndexOf('![[');
	const found = locateAt(d, second, 'a.png')!;
	assert.equal(found.link.from, second);
	assert.equal(found.line.number, 6);
	assert.equal(found.unsupported, null);
});

test('refuses when the embed src does not match the link at that position', () => {
	const d = doc('![[a.png]]');
	assert.equal(locateAt(d, 0, 'b.png'), null);
});

test('matches URL-encoded markdown targets against decoded src', () => {
	const d = doc('![x](my%20photo.png)');
	assert.ok(locateAt(d, 0, 'my photo.png'));
});

test('a position inside a link finds that link', () => {
	const d = doc('see ![[a.png]] and ![[b.png]]');
	const found = locateAt(d, 'see ![[a.png]] and ![['.length + 2)!;
	assert.equal(found.link.target, 'b.png');
});

test('flags contexts that are display only in v1', () => {
	const cases: [string, string][] = [
		['| a | ![[x.png\\|60]] |\n| --- | --- |', 'in a table'],
		['> ![[x.png]]', 'in a quote or callout'],
		['- ![[x.png]]', 'in a list'],
		['# ![[x.png]]', 'in a heading'],
		['```\n![[x.png]]\n```', 'not body text'],
		// Lines that continue a list item, quote or footnote without its marker, and footnotes.
		['- item\n![[x.png|wrap-left]]', 'in a list'],
		['> quote\n![[x.png|wrap-left]]', 'in a quote or callout'],
		['[^1]: ![[x.png|wrap-left]] note', 'in a footnote'],
		['[^1]: note\nmore ![[x.png|wrap-left]]', 'in a footnote'],
		['- item\n\n  ![[x.png|wrap-left]]', 'in a list'],
	];
	for (const [text, reason] of cases) {
		const d = doc(text);
		const pos = d.toString().indexOf('![[');
		const found = locateAt(d, pos);
		assert.ok(found, text);
		assert.equal(found.unsupported, reason, text);
	}
});

test('body text images the toolbar and dragging act on, wherever a paragraph puts them', () => {
	for (const text of [
		'Intro.\n\n ![[x.png|wrap-left]]\nText.', // one to three spaces change nothing
		'Intro.\n\n   ![[x.png|wrap-left]]\nText.',
		'- item\n\n ![[x.png|wrap-left]]\nText.', // too little indent for the item: the list has ended
		'Paragraph.\n    ![[x.png|wrap-left]]', // indented code cannot interrupt a paragraph
		'Text right above.\n[^1]: ![[x.png|wrap-left]] note', // drawn as text under a paragraph
		'![[square.png|constructor|200]]',
	]) {
		const d = doc(text);
		const found = locateAt(d, d.toString().indexOf('!['));
		assert.ok(found, text);
		assert.equal(found.unsupported, null, text);
	}
	assert.deepEqual(locateAt(doc('![[square.png|constructor|200]]'), 0)!.link.layout, { wrap: 'none', gap: 16 });
});

test('a link inside inline code, inline math or a one-line comment is not found', () => {
	for (const text of [
		'Write `![[a.png|120]]` to embed a picture.',
		'Double ``![[a.png|120]]`` here.',
		'Comment %%![[a.png|120]]%% here.',
		'Math $![[a.png|120]]$ here.',
		'Markdown `![alt|120](a.png)` here.',
	]) {
		const d = doc(text);
		const pos = text.indexOf('![');
		assert.equal(locateAt(d, pos), null, text);
		assert.equal(locateAt(d, pos + 4), null, text);
	}
	// The real image beside a code span is still found.
	const d = doc('Real `code` then ![[a.png|120]] here.');
	assert.equal(locateAt(d, d.toString().indexOf('![['))?.link.target, 'a.png');
});

test('returns null where there is no image link', () => {
	assert.equal(locateAt(doc('plain text'), 3), null);
	assert.equal(locateAt(doc('x'), 99), null);
});
