// M2 acceptance, part 2 (Fixture.md): the same image twice, writes deep in the note, the native corner
// resize, remote, table and transcluded images, leaf changes and the "show toolbar" setting.
//   node scripts/obsidian.mjs run tests/e2e/toolbar-cases.mjs
// What it changes (the note, the "show toolbar" setting, a second pane) is put back also when a run stops
// early.
import {
	clickButton,
	clickText,
	closeLightbox,
	diffLines,
	drawn,
	freshNote,
	geometryProblems,
	pressed,
	probe,
	scrollToLink,
	showImage,
	sleep,
	sourceNote,
	state,
	waitFor,
	waitForImage,
} from './toolbar-helpers.mjs';

const NOTE = 'Fixture.md';
const PLUGIN = 'image-text-wrap';

/** The centre of the first picture matching `selector`, once one is drawn (null if none is in time). */
const pictureIn = (page, selector) =>
	waitFor(() =>
		page.evaluate((selector) => {
			const r = document.querySelector(selector)?.getBoundingClientRect();
			return r && r.width > 0 ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
		}, selector),
	);

/** Scrolls the picture of `needle` into view and returns its rectangle once drawn; throws if it is not. */
const pictureOf = async (page, needle) => drawn(await showImage(page, needle), needle);

export default probe(async (h, check, restore) => {
	const { page } = h;
	const errors = h.watchErrors(page);
	await h.setWindowSize(page, 1280, 900);
	const original = sourceNote(NOTE);
	restore(() => h.setNote(page, NOTE, original));
	restore(() => closeLightbox(page));
	// A mouse button held down for a drag is let go.
	let held = false;
	restore(async () => held && (await page.mouse.up()));
	await freshNote(page, h, NOTE);

	// The same image embedded twice (lines 48 and 51) changes independently.
	let img = await pictureOf(page, '![[square.png|180]]');
	await page.mouse.click(img.x, img.y);
	await sleep(400);
	let before = await state(page);
	check('second square.png: toolbar shows "in line"', before.visible && pressed(before).join() === 'In line with text', pressed(before));
	await clickButton(page, 'Wrap text right');
	let after = await state(page);
	let diff = diffLines(before.doc, after.doc);
	check('same image twice: only the clicked copy changes (wrap right)', diff.length === 1 && diff[0].line === 51 && diff[0].after === '![[square.png|wrap-right|180]]', diff);
	check('deep in the note: no scrolling', after.scrollTop === before.scrollTop && before.scrollTop > 1000, [before.scrollTop, after.scrollTop]);
	img = drawn(await waitForImage(page, '![[square.png|wrap-left|180]]'), '![[square.png|wrap-left|180]]');
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
	img = drawn(await waitForImage(page, '![[square.png|wrap-left|180]]'), '![[square.png|wrap-left|180]]');
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
	img = await pictureOf(page, '![[landscape.png|wrap-left|300]]');
	await page.mouse.click(img.x, img.y);
	await sleep(400);
	before = await state(page);
	const corner = before.native.find((n) => n.cls.includes('image-resize-corner'));
	if (!corner) throw new Error(`no resize corner on the selected picture (selected: ${before.selected})`);
	const cx = (corner.left + corner.right) / 2;
	const cy = (corner.top + corner.bottom) / 2;
	await page.mouse.move(cx, cy);
	await page.mouse.down();
	held = true;
	for (let i = 1; i <= 10; i++) {
		await page.mouse.move(cx - 6 * i, cy - 4 * i);
		await sleep(30);
	}
	await sleep(150);
	const during = await state(page);
	await page.mouse.up();
	held = false;
	await sleep(500);
	after = await state(page);
	diff = diffLines(before.doc, after.doc);
	check('native corner resize keeps the layout tokens', diff.length === 1 && /^!\[\[landscape\.png\|wrap-left\|\d+\]\]$/.test(diff[0].after) && diff[0].after !== diff[0].before, diff);
	check('toolbar follows the picture during and after the resize', geometryProblems(during).length === 0 && after.visible && geometryProblems(after).length === 0, { during: { toolbar: during.toolbar, picture: during.picture, problems: geometryProblems(during) }, after: { toolbar: after.toolbar, picture: after.picture } });
	await page.keyboard.press('Meta+z');
	await sleep(300);
	check('(info) one undo reverts the native resize', (await state(page)).doc === original, 'Obsidian writes the resize itself');

	// Dragging the selected picture: the toolbar is not painted in any frame of the drag, and after Esc
	// cancels the drag it is back where it was, the picture still selected.
	await clickText(page);
	img = await pictureOf(page, '![[landscape.png|wrap-left|300]]');
	await page.mouse.click(img.x, img.y);
	await sleep(400);
	before = await state(page);
	restore(() => page.evaluate(() => delete window.__itwFrames));
	await page.evaluate(() => {
		// Every animation frame: is the drag on, and is the toolbar painted?
		const frames = (window.__itwFrames = []);
		const tick = () => {
			const tb = document.querySelector('.itw-toolbar');
			frames.push({ dragging: document.body.classList.contains('itw-dragging'), painted: !!tb && getComputedStyle(tb).visibility === 'visible' });
			if (window.__itwFrames === frames && frames.length < 3000) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
	await page.mouse.move(img.x, img.y);
	await page.mouse.down();
	held = true;
	await page.mouse.move(img.x + 8, img.y + 8, { steps: 2 });
	await page.mouse.move(img.x + 260, img.y + 160, { steps: 14 });
	await sleep(250);
	await page.keyboard.press('Escape');
	await sleep(300);
	await page.mouse.up();
	held = false;
	await sleep(500);
	after = await state(page);
	const dragFrames = await page.evaluate(() => {
		const frames = window.__itwFrames;
		delete window.__itwFrames;
		return frames;
	});
	const whileDragging = dragFrames.filter((f) => f.dragging);
	check('toolbar hidden in every frame of a drag of its picture', whileDragging.length > 5 && whileDragging.every((f) => !f.painted), { framesDragging: whileDragging.length, paintedWhileDragging: whileDragging.filter((f) => f.painted).length });
	check('after Esc cancels the drag: toolbar back in place, picture still selected, note unchanged', after.visible && after.selected && after.doc === original && JSON.stringify(after.toolbar) === JSON.stringify(before.toolbar) && dragFrames[dragFrames.length - 1].painted, { before: before.toolbar, after: after.toolbar, selected: after.selected });

	// Remote (data URI) image: Obsidian selects it the same way, and its link is found by position.
	await clickText(page);
	img = await pictureOf(page, '![teal|wrap-right|120]');
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
	// The table's picture is drawn inside Obsidian's table widget, where imageRect does not look.
	await scrollToLink(page, '![[square.png\\|60]]');
	const tableImg = await pictureIn(page, '.workspace-leaf.mod-active .cm-content .cm-table-widget .image-embed img');
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
	await scrollToLink(page, '![[Transcluded source]]');
	const t = (await state(page)).doc.indexOf('![[Transcluded source]]');
	const tr = await pictureIn(page, '.workspace-leaf.mod-active .cm-content .markdown-embed .image-embed img');
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
	img = await pictureOf(page, '![[landscape.png|wrap-left|300]]');
	await page.mouse.click(img.x, img.y);
	await sleep(400);
	s = await state(page);
	const shownBefore = s.visible;
	restore(() =>
		page.evaluate(() => {
			window.__itwOtherLeaf?.detach();
			delete window.__itwOtherLeaf;
		}),
	);
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

	// The "Show the picture toolbar" setting, switched off through the plugin's settings tab: the same call
	// its toggle in Obsidian's Settings makes. (Opening the Settings window itself would bring Obsidian to the
	// front, taking the keyboard from whoever is using the computer.)
	await clickText(page);
	img = await pictureOf(page, '![[landscape.png|wrap-left|300]]');
	await page.mouse.click(img.x, img.y);
	await sleep(400);
	const showToolbar = await page.evaluate((id) => app.plugins.plugins[id].settings.showToolbar, PLUGIN);
	restore(() =>
		page.evaluate(
			async ({ id, showToolbar }) => {
				const plugin = app.plugins.plugins[id];
				if (plugin.settings.showToolbar !== showToolbar) await plugin.updateSettings({ ...plugin.settings, showToolbar });
			},
			{ id: PLUGIN, showToolbar },
		),
	);
	const shownBeforeSetting = (await state(page)).visible;
	const setting = await page.evaluate(async (id) => {
		const tab = app.setting.pluginTabs.find((t) => t.id === id);
		await tab.setControlValue('showToolbar', false);
		return { saved: app.plugins.plugins[id].settings.showToolbar, shownInSettings: tab.getControlValue('showToolbar') };
	}, PLUGIN);
	await sleep(400);
	s = await state(page);
	check('setting off: no toolbar on the selected image', shownBeforeSetting && setting.saved === false && setting.shownInSettings === false && s.selected && !s.visible, { shownBeforeSetting, setting, selected: s.selected, visible: s.visible });
	await clickText(page);
	await page.mouse.click(img.x, img.y);
	await sleep(400);
	s = await state(page);
	check('setting off: selecting an image shows nothing', !s.visible && s.selected, { visible: s.visible, selected: s.selected });
	// The setting is switched back by the restore step above.

	check('no console errors', errors.length === 0, errors);
});
