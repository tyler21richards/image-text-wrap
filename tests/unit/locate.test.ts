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
	];
	for (const [text, reason] of cases) {
		const d = doc(text);
		const pos = d.toString().indexOf('![[');
		const found = locateAt(d, pos);
		assert.ok(found, text);
		assert.equal(found.unsupported, reason, text);
	}
});

test('returns null where there is no image link', () => {
	assert.equal(locateAt(doc('plain text'), 3), null);
	assert.equal(locateAt(doc('x'), 99), null);
});
