import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lineOffset, linkForDrawnImage, sectionImageLinks } from '../../src/ui/section-images.ts';

const note = [
	'# Title', // 0
	'', // 1
	'![[a.png|wrap-left|300]]', // 2
	'Text beside it with ![[b.png]] inline and ![[Some note]] embedded.', // 3
	'', // 4
	'![x|wrap-right](https://example.com/c.png)', // 5
	'| Cell | ![[d.png\\|60]] |', // 6
];

test('lists the image links of a section in reading order, skipping note embeds', () => {
	const links = sectionImageLinks(note, 2, 3);
	assert.deepEqual(
		links.map((l) => [l.line, l.link.target, l.link.from]),
		[
			[2, 'a.png', 0],
			[3, 'b.png', 20],
		],
	);
});

test('remote images and table rows are included', () => {
	assert.deepEqual(
		sectionImageLinks(note, 5, 6).map((l) => [l.line, l.link.target, l.link.separator]),
		[
			[5, 'https://example.com/c.png', '|'],
			[6, 'd.png', '\\|'],
		],
	);
});

test('the n-th drawn image maps to the n-th link only when the counts agree', () => {
	const links = sectionImageLinks(note, 2, 3);
	assert.equal(linkForDrawnImage(links, 2, 1)?.link.target, 'b.png');
	assert.equal(linkForDrawnImage(links, 1, 0), null); // one image failed to draw: refuse
	assert.equal(linkForDrawnImage(links, 2, -1), null);
	assert.equal(linkForDrawnImage(links, 2, 2), null);
});

test('line offsets match the joined text', () => {
	const text = note.join('\n');
	for (let n = 0; n < note.length; n++) assert.equal(text.slice(lineOffset(note, n)).split('\n')[0], note[n]);
});
