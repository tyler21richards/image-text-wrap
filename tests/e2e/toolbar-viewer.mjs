// Obsidian's image viewer (its full-window lightbox) never shows layout words. Its title is the caption
// without them, or the file name when there is no caption, in Live Preview (second click on a selected
// picture) and Reading view (one click), also after the arrow keys move to another picture. The pictures
// in the note keep the words in their alt text, where styles.css reads them.
//   node scripts/obsidian.mjs run tests/e2e/toolbar-viewer.mjs
import { clickButton, clickText, closeLightbox, imageRect, probe, showImage, sleep, sourceNote, state } from './toolbar-helpers.mjs';

const NOTE = 'Viewer titles.md';
const TEAL = sourceNote('Fixture.md')
	.split('\n')
	.find((l) => l.startsWith('![teal|wrap-right|120]('));
const TEXT = 'The quick brown fox jumps over the lazy dog, again and again, so that this paragraph runs to several lines.';
const ORIGINAL = [
	'# Viewer titles',
	'',
	'Plain picture, wrapped with the toolbar below. Nothing else is in this paragraph, which is long enough to click.',
	'',
	'![[square.png|200]]',
	'',
	`Captioned and wrapped. ${TEXT}`,
	'',
	'![[square.png|My dog|wrap-left|150]]',
	`Text beside the captioned picture. ${TEXT}`,
	'',
	'![[landscape.png|wrap-right|gap-24|300]]',
	`Text beside the wrapped picture. ${TEXT}`,
	'',
	TEAL,
	`Text beside the data picture. ${TEXT}`,
	'',
].join('\n');

/** Words a viewer must not show. */
const LAYOUT = /(^|\|)(wrap-(left|right|block)|gap-(0|8|16|24))(\||$)/;

/** The open viewer's title and its pictures' alt text, or null when none is open. */
const viewer = (page) =>
	page.evaluate(() => {
		const box = document.querySelector('.lightbox');
		if (!box) return null;
		return {
			title: box.querySelector('.lightbox-titlebar-text')?.textContent ?? null,
			alts: [...box.querySelectorAll('.lightbox-media img')].map((i) => i.getAttribute('alt')),
		};
	});

const clean = (v) => !!v && !LAYOUT.test(v.title ?? '') && v.alts.every((a) => !LAYOUT.test(a ?? ''));

export default probe(async (h, check) => {
	const { page } = h;
	const errors = h.watchErrors(page);
	await h.setWindowSize(page, 1280, 900);
	// The viewer opens in Obsidian's active window: a Settings window left open would get it instead.
	await page.evaluate(() => app.setting?.close());
	await sleep(300);
	try {
		await closeLightbox(page);
		await h.setNote(page, NOTE, ORIGINAL);
		await h.openNote(page, NOTE, 'live');
		await sleep(500);
		await clickText(page);

		// Live Preview: a second click on the selected picture opens the viewer.
		const lpTitle = async (needle) => {
			await clickText(page);
			const img = await showImage(page, needle);
			if (!img.found) throw new Error(`picture not drawn: ${needle}`);
			await page.mouse.click(img.x, img.y);
			await sleep(400);
			const selected = (await state(page)).selected;
			await page.mouse.click(img.x, img.y);
			await sleep(700);
			return { selected, viewer: await viewer(page) };
		};
		let r = await lpTitle('![[landscape.png|wrap-right|gap-24|300]]');
		check('Live Preview, wrapped picture with no caption: the viewer is titled with its file name', r.selected && r.viewer?.title === 'landscape.png' && clean(r.viewer), r);
		await page.keyboard.press('ArrowRight');
		await sleep(600);
		const next = await viewer(page);
		check('Live Preview, arrow key to the next picture: its caption without the layout words', next?.title === 'teal' && clean(next), next);
		await closeLightbox(page);
		r = await lpTitle('![[square.png|My dog|wrap-left|150]]');
		check('Live Preview, captioned wrapped picture: the viewer shows the caption alone', r.viewer?.title === 'My dog' && clean(r.viewer), r);
		await closeLightbox(page);

		// The toolbar wraps the plain picture; the viewer opened from it right after shows its file name.
		await clickText(page);
		const plain = await showImage(page, '![[square.png|200]]');
		await page.mouse.click(plain.x, plain.y);
		await sleep(400);
		await clickButton(page, 'Wrap text right');
		const wrapped = await state(page);
		const picture = await imageRect(page, '![[square.png|wrap-right|200]]');
		await page.mouse.click(picture.x, picture.y);
		await sleep(700);
		const afterToolbar = await viewer(page);
		check(
			'Live Preview, wrapped with the toolbar: the viewer is titled with the file name',
			wrapped.doc.split('\n')[4] === '![[square.png|wrap-right|200]]' && afterToolbar?.title === 'square.png' && clean(afterToolbar),
			{ line: wrapped.doc.split('\n')[4], viewer: afterToolbar },
		);
		await closeLightbox(page);
		const alts = await page.evaluate(() =>
			[...app.workspace.activeLeaf.view.editor.cm.contentDOM.querySelectorAll('.internal-embed.image-embed')].map((e) => e.getAttribute('alt')),
		);
		check('the pictures in the note keep their layout words in their alt text', alts.includes('wrap-right') && alts.includes('My dog|wrap-left'), alts);

		// Reading view: one click opens the viewer; the arrow keys go through every picture of the note.
		await h.setNote(page, NOTE, ORIGINAL);
		await h.openNote(page, NOTE, 'reading');
		await sleep(800);
		const first = await page.evaluate(() => {
			const img = document.querySelector('.workspace-leaf.mod-active .markdown-reading-view .internal-embed.image-embed img');
			const b = img?.getBoundingClientRect();
			return b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null;
		});
		if (!first) throw new Error('no picture drawn in Reading view');
		await page.mouse.click(first.x, first.y);
		await sleep(700);
		// Obsidian's viewer pages through every img of the note's sections, so the count includes any copy
		// of a wrapped picture Reading view shows in a later section.
		const pictures = await page.evaluate(() =>
			app.workspace.activeLeaf.view.previewMode.renderer.sections.reduce((n, s) => n + s.el.querySelectorAll('img').length, 0),
		);
		const seen = [await viewer(page)];
		for (let i = 1; i < pictures; i++) {
			await page.keyboard.press('ArrowRight');
			await sleep(500);
			seen.push(await viewer(page));
		}
		await page.keyboard.press('ArrowLeft');
		await sleep(500);
		const back = await viewer(page);
		const titles = seen.map((v) => v?.title ?? null);
		check(
			'Reading view: every title through the arrow keys is free of layout words; caption alone, or the file name',
			titles[0] === 'square.png' && ['My dog', 'landscape.png', 'teal'].every((t) => titles.includes(t)) && titles.indexOf('My dog') < titles.indexOf('landscape.png') && seen.every(clean) && back?.title === titles[titles.length - 2] && clean(back),
			{ pictures, seen, back },
		);
		await closeLightbox(page);
		check('the viewer closes', !(await viewer(page)), {});
	} finally {
		await closeLightbox(page);
		await h.setNote(page, NOTE, ORIGINAL);
		await h.openNote(page, NOTE, 'live');
	}
	check('no console errors', errors.length === 0, errors);
});
