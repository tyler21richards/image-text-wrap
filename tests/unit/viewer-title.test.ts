import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileNameOf, hasLayoutWords, viewerTitle, withoutLayoutWords } from '../../src/viewer-title.ts';

const LOCAL = 'app://4f1c2b/Users/me/vault/images/landscape.png?1760000000000';

test('titles without layout words are left as Obsidian wrote them', () => {
	for (const title of ['square.png', 'images/square.png', 'My dog', 'A|B', '', 'wrap-lefty', 'my wrap-left photo']) {
		assert.equal(viewerTitle(title, LOCAL), title);
	}
});

test('layout words are taken out of a caption', () => {
	assert.equal(viewerTitle('My dog|wrap-left', LOCAL), 'My dog');
	assert.equal(viewerTitle('My dog|wrap-right|gap-24', LOCAL), 'My dog');
	assert.equal(viewerTitle('wrap-block|My dog', LOCAL), 'My dog');
	assert.equal(viewerTitle('A|wrap-left|B', LOCAL), 'A|B');
	assert.equal(viewerTitle('teal|wrap-right', 'data:image/png;base64,iVBORw0KGgo='), 'teal');
});

test('a title of nothing but layout words becomes the file name', () => {
	assert.equal(viewerTitle('wrap-right', LOCAL), 'landscape.png');
	assert.equal(viewerTitle('wrap-right|gap-24', LOCAL), 'landscape.png');
	assert.equal(viewerTitle('gap-8', 'http://127.0.0.1:8080/pics/My%20photo.jpg#x'), 'My photo.jpg');
	// Obsidian shows no name for a data URI either.
	assert.equal(viewerTitle('wrap-left', 'data:image/png;base64,iVBORw0KGgo='), '');
});

test('only exact layout words count, as styles.css matches them', () => {
	assert.equal(hasLayoutWords('My dog | wrap-left'), false);
	assert.equal(hasLayoutWords('Wrap-Left'), false);
	assert.equal(hasLayoutWords('wrap-left '), false);
	assert.equal(hasLayoutWords('gap-12'), false);
	assert.equal(hasLayoutWords('x|gap-0'), true);
	assert.equal(withoutLayoutWords('wrap-left|gap-24'), '');
	assert.equal(withoutLayoutWords('a\\|b|wrap-left'), 'a\\|b');
});

test('cleaning twice changes nothing more', () => {
	for (const title of ['My dog|wrap-left', 'wrap-right', 'A|wrap-left|B']) {
		const once = viewerTitle(title, LOCAL);
		assert.equal(viewerTitle(once, LOCAL), once);
	}
});

test('file names are read from any picture address', () => {
	assert.equal(fileNameOf(LOCAL), 'landscape.png');
	assert.equal(fileNameOf('https://example.com/a/b%20c.webp?w=300'), 'b c.webp');
	assert.equal(fileNameOf('https://example.com/a/100%.png'), '100%.png');
	assert.equal(fileNameOf('images/square.png'), 'square.png');
	assert.equal(fileNameOf('DATA:image/gif;base64,R0lGOD'), '');
	assert.equal(fileNameOf(''), '');
});
