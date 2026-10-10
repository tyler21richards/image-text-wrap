// M2 acceptance, part 4: the right-click menu entries and the commands.
//   node scripts/obsidian.mjs run tests/e2e/toolbar-menu.mjs
// Real right-clicks need Obsidian's DOM menus, so this switches the test vault to non-native menus
// (macOS defaults to native ones, which the DevTools protocol cannot click) and puts the setting back after.
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	clickMenuItem,
	clickText,
	closeLightbox,
	diffLines,
	freshNote,
	imageRect,
	probe,
	showImage,
	sleep,
	sourceNote,
	state,
} from './toolbar-helpers.mjs';

const OURS = ['In line with text', 'Wrap text left', 'Wrap text right', 'Top and bottom'];
const SPACING = ['Spacing: None', 'Spacing: Small (8 px)', 'Spacing: Medium (16 px)', 'Spacing: Large (24 px)'];

// A note with a local, two remote and a data-URI image (written by this probe, not in test-vault).
const REMOTE_NOTE = 'Remote images.md';
const REMOTE_IMAGES = [
	['local', '![[square.png|80]]'],
	['remoteWrapped', '![remote|wrap-left|100]'],
	['remotePlain', '![remote plain|100]'],
	['data', '![teal|120]'],
];
const remoteNote = (base) =>
	[
		'# Remote images',
		'',
		'Opening paragraph. The quick brown fox jumps over the lazy dog, again and again, so that it wraps.',
		'',
		'![[square.png|80]]',
		'',
		'Text after the local image. The quick brown fox jumps over the lazy dog.',
		'',
		`![remote|wrap-left|100](${base}/a.png)`,
		'',
		'Text beside the wrapped remote image. The quick brown fox jumps over the lazy dog, again and again, so that this paragraph spans several lines.',
		'',
		`![remote plain|100](${base}/b.png)`,
		'',
		'Text after the plain remote image. The quick brown fox jumps over the lazy dog.',
		'',
		sourceNote('Fixture.md')
			.split('\n')
			.find((l) => l.startsWith('![teal|'))
			.replace('|wrap-right|', '|'),
		'',
		'Text after the data image. The quick brown fox jumps over the lazy dog.',
		'',
	].join('\n');

/** Serves test-vault/images/square.png on a free local port while `body(baseUrl)` runs. */
async function withImageServer(body) {
	const png = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../test-vault/images/square.png'));
	const server = createServer((_req, res) => {
		res.writeHead(200, { 'content-type': 'image/png' });
		res.end(png);
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	try {
		await body(`http://127.0.0.1:${server.address().port}`);
	} finally {
		server.close();
	}
}

/** Right-clicks a picture near its bottom-left corner, clear of Obsidian's zoom/edit buttons and resize corner. */
async function rightClickCorner(page, needle) {
	const img = await imageRect(page, needle);
	await page.mouse.click(img.left + 6, img.bottom - 6, { button: 'right' });
	await sleep(400);
	return state(page);
}

async function rightClick(page, needle) {
	const img = await imageRect(page, needle);
	await page.mouse.click(img.left + 30, img.top + 30, { button: 'right' });
	await sleep(400);
	return state(page);
}

async function closeMenu(page) {
	if ((await state(page)).menu.length) {
		await page.keyboard.press('Escape');
		await sleep(200);
	}
}

async function palette(page, text) {
	await page.keyboard.press('Meta+p');
	await sleep(400);
	await page.keyboard.type(text);
	await sleep(400);
	return page.evaluate(() => [...document.querySelectorAll('.prompt .suggestion-item')].map((e) => e.querySelector('.suggestion-title')?.textContent ?? e.textContent));
}

export default probe(async (h, check) => {
	const { page } = h;
	const errors = h.watchErrors(page);
	await h.setWindowSize(page, 1280, 900);
	// After a fresh launch Obsidian's Settings window is open (it opens when the vault is trusted) and is
	// Obsidian's active window, which is where notices go: close it first.
	await page.evaluate(() => app.setting?.close());
	await sleep(500);
	const nativeBefore = await page.evaluate(() => app.vault.getConfig('nativeMenus'));
	await page.evaluate(() => app.vault.setConfig('nativeMenus', false));
	const NOTE = 'Plain images.md';
	const LINK = '![[landscape.png|320]]';
	const original = sourceNote(NOTE);

	try {
		// Live Preview: right-click an image.
		await freshNote(page, h, NOTE);
		await showImage(page, LINK);
		let s = await rightClick(page, LINK);
		const titles = s.menu.map((m) => m.title);
		check('right-click menu has the four layout choices, "in line" checked, no spacing while in line', OURS.every((t) => titles.includes(t)) && s.menu.find((m) => m.checked)?.title === 'In line with text' && !titles.some((t) => t.startsWith('Spacing')), s.menu);
		const ours = s.menu.filter((m) => OURS.includes(m.title));
		check('layout choices form their own group, just above "Delete image"', ours.length === 4 && ours.every((m) => m.section === 'image-text-wrap') && titles.indexOf('Top and bottom') === titles.indexOf('Delete image') - 1 && titles.slice(titles.indexOf('In line with text'), titles.indexOf('Top and bottom') + 1).join() === OURS.join(), titles);
		const top = s.scrollTop;
		await clickMenuItem(page, 'Wrap text right');
		s = await state(page);
		let diff = diffLines(original, s.doc);
		check('menu "Wrap text right" changes only this link, no scrolling', diff.length === 1 && diff[0].after === '![[landscape.png|wrap-right|320]]' && s.scrollTop === top, { diff, scrollTop: [top, s.scrollTop] });

		s = await rightClick(page, LINK.replace('|320', '|wrap-right|320'));
		check('menu shows "Wrap text right" checked and the spacing choices, medium checked', s.menu.filter((m) => m.checked).map((m) => m.title).join() === 'Wrap text right,Spacing: Medium (16 px)' && SPACING.every((t) => s.menu.some((m) => m.title === t)), s.menu.filter((m) => m.title.startsWith('Spacing') || OURS.includes(m.title)));
		await clickMenuItem(page, 'Spacing: Small (8 px)');
		s = await state(page);
		diff = diffLines(original, s.doc);
		check('menu spacing "Small (8 px)" writes gap-8', diff.length === 1 && diff[0].after === '![[landscape.png|wrap-right|gap-8|320]]', diff);

		s = await rightClick(page, '![[landscape.png|wrap-right|gap-8|320]]');
		await clickMenuItem(page, 'Wrap text right');
		s = await state(page);
		check('menu: clicking the checked wrap choice turns wrapping off', s.doc === original, diffLines(original, s.doc));
		const undo = [];
		for (let i = 0; i < 3; i++) {
			await page.keyboard.press('Meta+z');
			await sleep(300);
			undo.push((await state(page)).doc.split('\n')[4]);
		}
		check('menu actions undo one step each', undo.join(' ; ') === '![[landscape.png|wrap-right|gap-8|320]] ; ![[landscape.png|wrap-right|320]] ; ![[landscape.png|320]]', undo);

		// The note changes while the menu is open: nothing is written, and an English notice says so.
		s = await rightClick(page, LINK);
		await page.evaluate(() => {
			const cm = app.workspace.activeLeaf.view.editor.cm;
			cm.dispatch({ changes: { from: 0, insert: 'Edited elsewhere.\n' } });
		});
		await sleep(200);
		await clickMenuItem(page, 'Wrap text left');
		s = await state(page);
		const notices = await page.evaluate(() => [...document.querySelectorAll('.notice')].map((n) => n.textContent));
		check('note changed while the menu was open: link untouched, English notice', s.doc === `Edited elsewhere.\n${original}` && notices.some((n) => n.startsWith('The note changed while you were working on the image')), { notices, line6: s.doc.split('\n')[5] });
		await h.setNote(page, NOTE, original);
		await sleep(300);

		// No entries for images in a table or a transcluded note.
		await freshNote(page, h, 'Fixture.md');
		await showImage(page, '![[square.png\\|60]]');
		const tableImg = await page.evaluate(() => {
			const r = document.querySelector('.workspace-leaf.mod-active .cm-table-widget .image-embed img')?.getBoundingClientRect();
			return r && { x: r.left + r.width / 2, y: r.top + r.height / 2 };
		});
		await page.mouse.click(tableImg.x, tableImg.y, { button: 'right' });
		await sleep(400);
		s = await state(page);
		check('image in a table: no layout entries', s.menu.length > 0 && !s.menu.some((m) => OURS.includes(m.title)), s.menu.map((m) => m.title));
		await closeMenu(page);
		await closeLightbox(page);
		await clickText(page);
		await page.evaluate(() => {
			const cm = app.workspace.activeLeaf.view.editor.cm;
			cm.dispatch({ effects: cm.constructor.scrollIntoView(cm.state.doc.toString().indexOf('![[Transcluded source]]'), { y: 'center' }) });
		});
		await sleep(500);
		const trImg = await page.evaluate(() => {
			const r = document.querySelector('.workspace-leaf.mod-active .cm-content .markdown-embed .image-embed img')?.getBoundingClientRect();
			return r && { x: r.left + r.width / 2, y: r.top + r.height / 2 };
		});
		await page.mouse.click(trImg.x, trImg.y, { button: 'right' });
		await sleep(400);
		s = await state(page);
		check('image in a transcluded note: no layout entries', !s.menu.some((m) => OURS.includes(m.title)), s.menu.map((m) => m.title));
		await closeMenu(page);
		await closeLightbox(page);

		// Remote and data-URI images: Obsidian builds their menu itself and fires no file-menu; the entries
		// are added to that same menu, once. The remote pictures come from a server in this process.
		await withImageServer(async (base) => {
			const text = remoteNote(base);
			await h.setNote(page, REMOTE_NOTE, text);
			await h.openNote(page, REMOTE_NOTE, 'live');
			await sleep(800);
			await clickText(page);
			const menus = {};
			for (const [name, needle] of REMOTE_IMAGES) {
				await showImage(page, needle);
				const m = await rightClickCorner(page, needle);
				menus[name] = { obsidian: m.menu.some((i) => i.title === 'Copy image'), ours: m.menu.filter((i) => OURS.includes(i.title) || i.title.startsWith('Spacing')).map((i) => `${i.title}${i.checked ? ' (checked)' : ''}`) };
				await closeMenu(page);
			}
			check('remote image (wrapped): the layout and spacing entries in Obsidian\'s own menu, "wrap left" and medium checked', menus.remoteWrapped.obsidian && menus.remoteWrapped.ours.join() === 'In line with text,Wrap text left (checked),Wrap text right,Top and bottom,Spacing: None,Spacing: Small (8 px),Spacing: Medium (16 px) (checked),Spacing: Large (24 px)', menus.remoteWrapped);
			check('remote image (in line): the four layout entries once, "in line" checked', menus.remotePlain.obsidian && menus.remotePlain.ours.join() === 'In line with text (checked),Wrap text left,Wrap text right,Top and bottom', menus.remotePlain);
			check('data-URI image: the four layout entries once', menus.data.obsidian && menus.data.ours.join() === 'In line with text (checked),Wrap text left,Wrap text right,Top and bottom', menus.data);
			check('local image beside them: the entries once (no duplicates)', menus.local.ours.join() === 'In line with text (checked),Wrap text left,Wrap text right,Top and bottom', menus.local);

			await rightClickCorner(page, '![remote plain|100]');
			await clickMenuItem(page, 'Wrap text right');
			let r = await state(page);
			let rdiff = diffLines(text, r.doc);
			check('remote image menu "Wrap text right" changes only its link', rdiff.length === 1 && rdiff[0].after === `![remote plain|wrap-right|100](${base}/b.png)`, rdiff);
			await rightClickCorner(page, '![remote|wrap-left|100]');
			await clickMenuItem(page, 'Spacing: Large (24 px)');
			await rightClickCorner(page, '![teal|120]');
			await clickMenuItem(page, 'Top and bottom');
			r = await state(page);
			rdiff = diffLines(text, r.doc);
			const at = (line) => rdiff.find((d) => d.line === line)?.after ?? '';
			check('remote spacing and data-URI "Top and bottom" write only their links', rdiff.length === 3 && at(9) === `![remote|wrap-left|gap-24|100](${base}/a.png)` && at(17).startsWith('![teal|wrap-block|120](data:'), rdiff.map((d) => ({ line: d.line, after: d.after.slice(0, 50) })));
			for (let i = 0; i < 3; i++) {
				await page.keyboard.press('Meta+z');
				await sleep(300);
			}
			check('remote and data-URI menu actions undo one step each', (await state(page)).doc === text, diffLines(text, (await state(page)).doc));
		});

		// Native menus (the macOS default): the entries are added to the same menu object.
		await page.evaluate(() => app.vault.setConfig('nativeMenus', true));
		await freshNote(page, h, NOTE);
		await showImage(page, LINK);
		await page.evaluate(() => {
			window.__itwItems = null;
			window.__itwRef = app.workspace.on('file-menu', (menu) => {
				window.__itwMenuClass = menu.constructor;
				// Runs after the plugin's handler (registered later). Reads Obsidian's internal item list, for evidence only.
				setTimeout(() => {
					window.__itwItems = (menu.items ?? []).map((i) => i.titleEl?.textContent ?? i.title ?? null);
				});
			});
		});
		const img = await imageRect(page, LINK);
		await page.mouse.click(img.left + 30, img.top + 30, { button: 'right' });
		await sleep(600);
		await page.keyboard.press('Escape');
		await sleep(300);
		const nativeItems = await page.evaluate(() => {
			app.workspace.offref(window.__itwRef);
			return window.__itwItems;
		});
		check('native menu: the four layout entries are added', Array.isArray(nativeItems) && OURS.every((t) => nativeItems.includes(t)), nativeItems);
		// A data-URI image has no file-menu: its native menu is read as Obsidian shows it (evidence only).
		await freshNote(page, h, 'Fixture.md');
		await showImage(page, '![teal|wrap-right|120]');
		await page.evaluate(() => {
			const proto = window.__itwMenuClass.prototype;
			window.__itwShow = proto.showAtMouseEvent;
			window.__itwOwn = Object.hasOwn(proto, 'showAtMouseEvent');
			window.__itwItems = null;
			proto.showAtMouseEvent = function (...args) {
				window.__itwItems = (this.items ?? []).map((i) => i.titleEl?.textContent ?? i.title ?? null);
				return window.__itwShow.apply(this, args);
			};
		});
		await rightClickCorner(page, '![teal|wrap-right|120]');
		await sleep(200);
		await page.keyboard.press('Escape');
		await sleep(300);
		const nativeData = await page.evaluate(() => {
			const proto = window.__itwMenuClass.prototype;
			if (window.__itwOwn) proto.showAtMouseEvent = window.__itwShow;
			else delete proto.showAtMouseEvent;
			delete window.__itwShow;
			delete window.__itwOwn;
			delete window.__itwMenuClass;
			return window.__itwItems;
		});
		check('native menu of a data-URI image: the layout entries are added once', Array.isArray(nativeData) && OURS.every((t) => nativeData.filter((x) => x === t).length === 1) && nativeData.includes('Spacing: Medium (16 px)'), nativeData);
		await page.evaluate(() => app.vault.setConfig('nativeMenus', false));

		// Commands, through the real command palette.
		await freshNote(page, h, NOTE);
		await showImage(page, LINK);
		const sel = await imageRect(page, LINK);
		await page.mouse.click(sel.x, sel.y);
		await sleep(400);
		let listed = await palette(page, 'selected image');
		check('palette with an in-line image selected: wrap commands shown, "in line" and spacing hidden', ['Wrap selected image: left', 'Wrap selected image: right', 'Wrap selected image: top and bottom'].every((t) => listed.some((l) => l.endsWith(t))) && !listed.some((l) => l.endsWith('in line with text') || l.includes('spacing')), listed);
		await page.keyboard.press('Escape');
		await sleep(200);
		listed = await palette(page, 'Wrap selected image: right');
		await page.keyboard.press('Enter');
		await sleep(400);
		s = await state(page);
		diff = diffLines(original, s.doc);
		check('command "Wrap selected image: right" changes only the selected link', diff.length === 1 && diff[0].after === '![[landscape.png|wrap-right|320]]', { listed, diff });
		listed = await palette(page, 'selected image');
		check('palette with a wrapped image: spacing commands shown except the current one', ['none', 'small (8 px)', 'large (24 px)'].every((g) => listed.some((l) => l.endsWith(`Set spacing of selected image: ${g}`))) && !listed.some((l) => l.endsWith('medium (16 px)')), listed);
		await page.keyboard.press('Escape');
		await sleep(200);
		await palette(page, 'Set spacing of selected image: large');
		await page.keyboard.press('Enter');
		await sleep(400);
		s = await state(page);
		check('command spacing large writes gap-24', s.doc.split('\n')[4] === '![[landscape.png|wrap-right|gap-24|320]]', s.doc.split('\n')[4]);
		await page.keyboard.press('Meta+z');
		await sleep(300);
		await page.keyboard.press('Meta+z');
		await sleep(300);
		check('commands undo one step each', (await state(page)).doc === original, diffLines(original, (await state(page)).doc));
		await clickText(page);
		listed = await palette(page, 'Wrap selected image');
		check('cursor on a plain text line: commands hidden', listed.every((l) => !l.includes('Wrap selected image')), listed);
		await page.keyboard.press('Escape');
		await sleep(200);
		// Source mode: the image link on the cursor's line.
		await h.openNote(page, NOTE, 'source');
		await page.evaluate(() => {
			const cm = app.workspace.activeLeaf.view.editor.cm;
			cm.focus();
			cm.dispatch({ selection: { anchor: cm.state.doc.line(5).to } });
		});
		await sleep(200);
		await palette(page, 'Wrap selected image: top and bottom');
		await page.keyboard.press('Enter');
		await sleep(400);
		s = await state(page);
		check('Source mode: command acts on the image link on the cursor line', s.doc.split('\n')[4] === '![[landscape.png|wrap-block|320]]' && diffLines(original, s.doc).length === 1, s.doc.split('\n')[4]);
		await h.setNote(page, NOTE, original);
		await h.openNote(page, NOTE, 'live');

		// Reading view. Obsidian 1.14.4 opens its lightbox on a right-click there and fires no file-menu
		// (checked below with a real right-click), so the plugin's Reading-view entries are exercised with a
		// synthetic contextmenu event plus a file-menu trigger, then a real write through vault.process.
		await freshNote(page, h, 'Fixture.md', 'reading');
		await sleep(400);
		const rv = await page.evaluate(() => {
			const r = document.querySelector('.workspace-leaf.mod-active .markdown-reading-view .internal-embed.image-embed img')?.getBoundingClientRect();
			return r && { x: r.left + r.width / 2, y: r.top + r.height / 2 };
		});
		await page.evaluate(() => {
			window.__itwRV = 0;
			window.__itwRVRef = app.workspace.on('file-menu', () => window.__itwRV++);
		});
		await page.mouse.click(rv.x, rv.y, { button: 'right' });
		await sleep(400);
		const rvReal = await page.evaluate(() => ({ fileMenus: window.__itwRV, lightbox: !!document.querySelector('.lightbox') }));
		await closeLightbox(page);
		await page.evaluate(() => app.workspace.offref(window.__itwRVRef));
		check('(Obsidian 1.14.4) Reading view right-click opens the lightbox and fires no file-menu', rvReal.fileMenus === 0 && rvReal.lightbox, rvReal);
		const synthetic = await page.evaluate(async () => {
			const OURS = ['In line with text', 'Wrap text left', 'Wrap text right', 'Top and bottom'];
			const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
			const view = app.workspace.activeLeaf.view;
			const run = async (el, pick) => {
				el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
				// A stand-in menu: every method chains, as Obsidian's core plugins also add their own items.
				const items = [];
				const chain = (target) => new Proxy(target, { get: (t, k) => (k in t ? t[k] : () => chain(t)) });
				const menu = chain({
					addItem: (cb) => {
						const it = chain({
							title: '',
							checked: null,
							onClickFn: null,
							setTitle: (v) => ((it.title = v), it),
							setChecked: (v) => ((it.checked = v), it),
							onClick: (fn) => ((it.onClickFn = fn), it),
						});
						items.push(it);
						cb(it);
						return menu;
					},
				});
				app.workspace.trigger('file-menu', menu, app.vault.getAbstractFileByPath('images/landscape.png'), 'link-context-menu');
				items.find((i) => i.title === pick)?.onClickFn?.();
				await sleep(400);
				return items.filter((i) => OURS.includes(i.title) || String(i.title).startsWith('Spacing')).map((i) => `${i.title}${i.checked ? ' (checked)' : ''}`);
			};
			const root = view.containerEl.querySelector('.markdown-reading-view');
			const out = {};
			view.previewMode.applyScroll(4);
			await sleep(500);
			out.local = await run(root.querySelector('.internal-embed.image-embed'), 'Wrap text right');
			view.previewMode.applyScroll(30);
			await sleep(500);
			const inTable = root.querySelector('table .image-embed');
			out.table = inTable ? await run(inTable, 'Wrap text right') : 'not rendered';
			view.previewMode.applyScroll(60);
			await sleep(500);
			const remote = [...root.querySelectorAll('p > img')].find((i) => i.getAttribute('alt')?.startsWith('teal'));
			out.remote = remote ? await run(remote, 'Top and bottom') : 'remote image not rendered';
			view.previewMode.applyScroll(65);
			await sleep(500);
			const inTransclusion = root.querySelector('.markdown-embed .image-embed');
			out.transclusion = inTransclusion ? await run(inTransclusion, 'Wrap text right') : 'not rendered';
			return out;
		});
		await sleep(400);
		const fixture = await h.getNote(page, 'Fixture.md');
		diff = diffLines(sourceNote('Fixture.md'), fixture);
		check('Reading view (synthetic menu): local image entries, "wrap left" checked', synthetic.local?.includes('Wrap text left (checked)'), synthetic.local);
		check('Reading view (synthetic menu): writes only the clicked link through the file', diff.some((d) => d.line === 5 && d.after === '![[landscape.png|wrap-right|300]]') && diff.every((d) => d.line === 5 || d.line === 61), diff.map((d) => ({ line: d.line, after: d.after.slice(0, 60) })));
		check('Reading view (synthetic menu): remote image handled by position', Array.isArray(synthetic.remote) && diff.some((d) => d.line === 61 && d.after.startsWith('![teal|wrap-block|120](data:')), { remote: synthetic.remote, line61: fixture.split('\n')[60].slice(0, 40) });
		check('Reading view (synthetic menu): no entries in a transclusion or table', Array.isArray(synthetic.transclusion) && synthetic.transclusion.length === 0 && Array.isArray(synthetic.table) && synthetic.table.length === 0, { transclusion: synthetic.transclusion, table: synthetic.table });
		await h.setNote(page, 'Fixture.md', sourceNote('Fixture.md'));
		await h.openNote(page, 'Fixture.md', 'live');
	} finally {
		await page.evaluate((v) => app.vault.setConfig('nativeMenus', v), nativeBefore);
		await h.setNote(page, NOTE, original);
	}
	check('no console errors', errors.length === 0, errors);
});
