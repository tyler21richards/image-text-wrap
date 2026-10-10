// M2 acceptance, part 2 (Fixture.md): the same image twice, writes deep in the note, the native corner
// resize, remote, table and transcluded images, leaf changes and the "show toolbar" setting.
//   node scripts/obsidian.mjs run tests/e2e/toolbar-cases.mjs
import {
	clickButton,
	clickText,
	closeLightbox,
	diffLines,
	freshNote,
	geometryProblems,
	imageRect,
	pressed,
	probe,
	showImage,
	sleep,
	sourceNote,
	state,
} from './toolbar-helpers.mjs';

const NOTE = 'Fixture.md';

export default probe(async (h, check) => {
	const { page } = h;
	const errors = h.watchErrors(page);
	await h.setWindowSize(page, 1280, 900);
	const original = sourceNote(NOTE);
	await freshNote(page, h, NOTE);

	// The same image embedded twice (lines 48 and 51) changes independently.
	let img = await showImage(page, '![[square.png|180]]');
	await page.mouse.click(img.x, img.y);
	await sleep(400);
	let before = await state(page);
	check('second square.png: toolbar shows "in line"', before.visible && pressed(before).join() === 'In line with text', pressed(before));
	await clickButton(page, 'Wrap text right');
	let after = await state(page);
	let diff = diffLines(before.doc, after.doc);
	check('same image twice: only the clicked copy changes (wrap right)', diff.length === 1 && diff[0].line === 51 && diff[0].after === '![[square.png|wrap-right|180]]', diff);
	check('deep in the note: no scrolling', after.scrollTop === before.scrollTop && before.scrollTop > 1000, [before.scrollTop, after.scrollTop]);
	img = await imageRect(page, '![[square.png|wrap-left|180]]');
	await page.mouse.click(img.x, img.y);
	await sleep(400);
	before = await state(page);
	check('first square.png: toolbar shows "wrap left"', before.visible && pressed(before).join() === 'Wrap text left', pressed(before));
	await clickButton(page, 'Wrap text left');
	after = await state(page);
	diff = diffLines(before.doc, after.doc);
	check('same image twice: only the first copy changes (wrap off)', diff.length === 1 && diff[0].line === 48 && diff[0].after === '![[square.png|180]]', diff);
	check('deep in the note: still no scrolling', after.scrollTop === before.scrollTop, [before.scrollTop, after.scrollTop]);
	const tops = [after.scrollTop];
	await page.keyboard.press('Meta+z');
	await sleep(350);
	tops.push((await state(page)).scrollTop);
	await page.keyboard.press('Meta+z');
	await sleep(350);
	after = await state(page);
	tops.push(after.scrollTop);
	check('two undos restore both copies', after.doc === original, diffLines(original, after.doc));
	check('undo deep in the note does not scroll', tops.every((t) => t === tops[0]), tops);

	// A picture near the top of the editor: CodeMirror's scroll anchor sits on the text below it, so a
	// height change of the picture's line used to move scrollTop (2263 -> 2443 measured before the fix).
	await clickText(page);
	await page.evaluate(() => {
		const cm = app.workspace.activeLeaf.view.editor.cm;
		const pos = cm.state.doc.toString().indexOf('![[square.png|wrap-left|180]]');
		cm.dispatch({ effects: cm.constructor.scrollIntoView(pos, { y: 'start', yMargin: 60 }) });
	});
	await sleep(500);
	img = await imageRect(page, '![[square.png|wrap-left|180]]');
	await page.mouse.click(img.x, img.y);
	await sleep(400);
	before = await state(page);
	await clickButton(page, 'Wrap text left');
	await sleep(600);
	after = await state(page);
	check(
		'picture near the top: turning wrap off keeps scrollTop and the picture in place',
		after.doc.split('\n')[47] === '![[square.png|180]]' && after.scrollTop === before.scrollTop && after.picture?.top === before.picture?.top,
		{ scrollTop: [before.scrollTop, after.scrollTop], pictureTop: [before.picture?.top, after.picture?.top], scrollerTop: before.scroller.top, toolbar: [before.toolbar, after.toolbar] },
	);
	await clickButton(page, 'Wrap text left');
	await sleep(600);
	const again = await state(page);
	check(
		'picture near the top: turning wrap back on keeps scrollTop',
		again.doc.split('\n')[47] === '![[square.png|wrap-left|180]]' && again.scrollTop === before.scrollTop,
		{ scrollTop: [before.scrollTop, after.scrollTop, again.scrollTop], pictureTop: again.picture?.top },
	);
	const undoTops = [];
	for (let i = 0; i < 2; i++) {
		await page.keyboard.press('Meta+z');
		await sleep(400);
		undoTops.push((await state(page)).scrollTop);
	}
	check('picture near the top: undo keeps scrollTop', undoTops.every((t) => t === before.scrollTop) && (await state(page)).doc === original, { before: before.scrollTop, undoTops });

	// Obsidian's own corner resize keeps the layout tokens, and the toolbar follows the picture.
	await clickText(page);
	img = await showImage(page, '![[landscape.png|wrap-left|300]]');
	await page.mouse.click(img.x, img.y);
	await sleep(400);
	before = await state(page);
	const corner = before.native.find((n) => n.cls.includes('image-resize-corner'));
	const cx = (corner.left + corner.right) / 2;
	const cy = (corner.top + corner.bottom) / 2;
	await page.mouse.move(cx, cy);
	await page.mouse.down();
	for (let i = 1; i <= 10; i++) {
		await page.mouse.move(cx - 6 * i, cy - 4 * i);
		await sleep(30);
	}
	await sleep(150);
	const during = await state(page);
	await page.mouse.up();
	await sleep(500);
	after = await state(page);
	diff = diffLines(before.doc, after.doc);
	check('native corner resize keeps the layout tokens', diff.length === 1 && /^!\[\[landscape\.png\|wrap-left\|\d+\]\]$/.test(diff[0].after) && diff[0].after !== diff[0].before, diff);
	check('toolbar follows the picture during and after the resize', geometryProblems(during).length === 0 && after.visible && geometryProblems(after).length === 0, { during: { toolbar: during.toolbar, picture: during.picture, problems: geometryProblems(during) }, after: { toolbar: after.toolbar, picture: after.picture } });
	await page.keyboard.press('Meta+z');
	await sleep(300);
	check('(info) one undo reverts the native resize', (await state(page)).doc === original, 'Obsidian writes the resize itself');

	// Remote (data URI) image: Obsidian selects it the same way, and its link is found by position.
	await clickText(page);
	img = await showImage(page, '![teal|wrap-right|120]');
	await page.mouse.click(img.x, img.y);
	await sleep(400);
	before = await state(page);
	check('data-URI image: toolbar shows "wrap right"', before.visible && pressed(before).join() === 'Wrap text right' && geometryProblems(before).length === 0, { pressed: pressed(before), problems: geometryProblems(before) });
	await clickButton(page, 'Top and bottom');
	after = await state(page);
	diff = diffLines(before.doc, after.doc);
	check('data-URI image: only its link changes', diff.length === 1 && diff[0].line === 61 && diff[0].after.startsWith('![teal|wrap-block|120](data:image/png;base64,') && diff[0].after.slice(30) === diff[0].before.slice(30).replace('wrap-right', 'wrap-block').slice(0, diff[0].after.length - 30), diff.map((d) => ({ line: d.line, before: d.before.slice(0, 50), after: d.after.slice(0, 50) })));
	await page.keyboard.press('Meta+z');
	await sleep(300);

	// Images in a table and in a transcluded note get no toolbar.
	await clickText(page);
	await showImage(page, '![[square.png\\|60]]');
	const tableImg = await page.evaluate(() => {
		const el = document.querySelector('.workspace-leaf.mod-active .cm-content .cm-table-widget .image-embed img');
		const r = el?.getBoundingClientRect();
		return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
	});
	let s;
	if (tableImg) {
		const docBefore = (await state(page)).doc;
		await page.mouse.click(tableImg.x, tableImg.y);
		await sleep(400);
		s = await state(page);
		check('image in a table: no toolbar', !s.visible, { visible: s.visible, selectedByObsidian: s.selected });
		// Obsidian's table editor may pad the table's cells when it is clicked; the plugin writes nothing here.
		const tableDiff = diffLines(docBefore, s.doc);
		const squash = (t) => t.replace(/-+/g, '-').replace(/ +/g, ' ');
		check('image in a table: the plugin changes no image link', tableDiff.every((d) => d.line >= 30 && d.line <= 33 && squash(d.after) === squash(d.before)), { obsidianTableFormatting: tableDiff });
		await page.keyboard.press('Escape');
		await sleep(200);
		await closeLightbox(page);
	} else {
		check('image in a table: no toolbar', false, 'table image not on screen');
	}
	await clickText(page);
	const t = await page.evaluate(() => {
		const cm = app.workspace.activeLeaf.view.editor.cm;
		const pos = cm.state.doc.toString().indexOf('![[Transcluded source]]');
		cm.dispatch({ effects: cm.constructor.scrollIntoView(pos, { y: 'center' }) });
		return pos;
	});
	await sleep(500);
	const tr = await page.evaluate(() => {
		const el = document.querySelector('.workspace-leaf.mod-active .cm-content .markdown-embed .image-embed img');
		if (!el) return null;
		const r = el.getBoundingClientRect();
		return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
	});
	if (tr) {
		const docBefore = (await state(page)).doc;
		await page.mouse.click(tr.x, tr.y);
		await sleep(400);
		s = await state(page);
		const lightbox = await page.evaluate(() => !!document.querySelector('.lightbox'));
		check('image in a transcluded note: no toolbar, note unchanged', !s.visible && s.doc === docBefore, { visible: s.visible, pos: t, obsidianOpenedItsViewer: lightbox });
		await page.keyboard.press('Escape');
		await sleep(200);
		await closeLightbox(page);
	} else {
		check('image in a transcluded note: no toolbar', false, 'transcluded image not on screen');
	}

	// Leaf change: open another note beside this one and focus it; come back.
	await clickText(page);
	img = await showImage(page, '![[landscape.png|wrap-left|300]]');
	await page.mouse.click(img.x, img.y);
	await sleep(400);
	s = await state(page);
	const shownBefore = s.visible;
	await page.evaluate(async () => {
		const leaf = app.workspace.getLeaf('split');
		await leaf.openFile(app.vault.getAbstractFileByPath('Plain images.md'));
		app.workspace.setActiveLeaf(leaf, { focus: true });
		window.__itwOtherLeaf = leaf;
	});
	await sleep(500);
	const other = await page.evaluate(() => [...document.querySelectorAll('.itw-toolbar')].some((t) => !t.classList.contains('itw-toolbar-hidden')));
	check('leaf change hides the toolbar', shownBefore && !other, { shownBefore, visibleAfterLeafChange: other });
	await page.evaluate(() => window.__itwOtherLeaf.detach());
	await sleep(500);

	// The "Show the picture toolbar" setting, switched off in the real settings window.
	await clickText(page);
	img = await showImage(page, '![[landscape.png|wrap-left|300]]');
	await page.mouse.click(img.x, img.y);
	await sleep(400);
	await page.evaluate(() => {
		app.setting.open();
		app.setting.openTabById('image-text-wrap');
	});
	await sleep(1000);
	// Obsidian 1.14 opens Settings in a window of its own.
	let settingsPage = null;
	for (const ctx of page.context().browser().contexts()) {
		for (const p of ctx.pages()) {
			if ((await p.title().catch(() => '')).startsWith('Settings')) settingsPage = p;
		}
	}
	const toggle = settingsPage
		? await settingsPage.evaluate(() => {
				const item = [...document.querySelectorAll('.setting-item')].find((i) => i.querySelector('.setting-item-name')?.textContent === 'Show the picture toolbar');
				const r = item?.querySelector('.checkbox-container')?.getBoundingClientRect();
				return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
			})
		: null;
	if (toggle) {
		await settingsPage.mouse.click(toggle.x, toggle.y);
		await sleep(400);
		await page.evaluate(() => app.setting.close());
		await sleep(800);
		s = await state(page);
		const setting = await page.evaluate(() => app.plugins.plugins['image-text-wrap'].settings.showToolbar);
		check('setting off (clicked in the Settings window): no toolbar on the selected image', setting === false && s.selected && !s.visible, { setting, selected: s.selected, visible: s.visible });
		await clickText(page);
		await page.mouse.click(img.x, img.y);
		await sleep(400);
		s = await state(page);
		check('setting off: selecting an image shows nothing', !s.visible && s.selected, { visible: s.visible, selected: s.selected });
		await page.evaluate(() => app.plugins.plugins['image-text-wrap'].updateSettings({ ...app.plugins.plugins['image-text-wrap'].settings, showToolbar: true }));
	} else {
		check('setting off', false, 'settings toggle not found');
	}

	check('no console errors', errors.length === 0, errors);
	await h.setNote(page, NOTE, original);
});
