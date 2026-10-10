// Reading view in a pop-out window, and unload cleanup: test-vault/Fixture.md is open in Reading view in
// the main window and in a pop-out; both get the note class and stand-ins. Disabling the plugin must
// remove every class and stand-in it added, from attached and detached sections, in both windows.
//
//   node scripts/obsidian.mjs run tests/e2e/reading-unload.mjs
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs in the page: what the plugin has added to every Reading view, attached or not. */
function census() {
	const out = [];
	app.workspace.iterateAllLeaves((leaf) => {
		const view = leaf.view;
		if (view.getViewType?.() !== 'markdown' || view.getMode() !== 'preview') return;
		const sections = view.previewMode.renderer.sections.map((s) => s.el);
		const doc = view.containerEl.doc;
		out.push({
			window: doc === document ? 'main' : 'popout',
			sections: sections.length,
			withNoteClass: sections.filter((el) => el.classList.contains('itw-wrap-note')).length,
			hosts: sections.filter((el) => el.classList.contains('itw-host') || el.classList.contains('itw-host-skip')).length,
			standIns: sections.reduce((n, el) => n + el.querySelectorAll('.itw-rv-stand-in').length, 0),
			anyInDocument: doc.querySelectorAll('.itw-wrap-note, .itw-host, .itw-host-skip, .itw-rv-stand-in').length,
			imageFloat: (() => {
				const e = doc.querySelector('.markdown-reading-view .image-embed[alt="A tall picture|wrap-right"]');
				return e ? e.win.getComputedStyle(e).float : null;
			})(),
		});
	});
	return out;
}

export default async ({ page, openNote, setWindowSize, watchErrors, reloadPlugin, cfg }) => {
	const errors = watchErrors(page);
	await setWindowSize(page, 1280, 900);
	await openNote(page, 'Fixture.md', 'reading');
	// The same note in a pop-out window.
	const popoutPage = page.context().waitForEvent('page', { timeout: 10000 }).catch(() => null);
	await page.evaluate(async () => {
		const leaf = app.workspace.openPopoutLeaf();
		await leaf.openFile(app.vault.getAbstractFileByPath('Fixture.md'), { state: { mode: 'preview' } });
	});
	const popout = await popoutPage;
	if (popout) popout.on('pageerror', (e) => errors.push(`popout: ${e}`));
	await sleep(1500);
	// Scroll both to the tall image so its stand-ins are planned.
	await page.evaluate(() => {
		app.workspace.iterateAllLeaves((leaf) => {
			const s = leaf.view.previewMode?.containerEl.querySelector('.markdown-preview-view');
			if (s) s.scrollTop = 700;
		});
	});
	await sleep(800);
	const result = { loaded: await page.evaluate(census) };
	await page.evaluate(() => app.plugins.disablePlugin('image-text-wrap'));
	await sleep(400);
	result.disabled = await page.evaluate(census);
	await reloadPlugin(page, cfg);
	await sleep(400);
	await page.evaluate(() => {
		app.workspace.iterateAllLeaves((leaf) => {
			const s = leaf.view.previewMode?.containerEl.querySelector('.markdown-preview-view');
			if (s) s.scrollTop = 720;
		});
	});
	await sleep(800);
	result.reEnabled = await page.evaluate(census);
	// Close the pop-out.
	await page.evaluate(() => {
		app.workspace.iterateAllLeaves((leaf) => {
			if (leaf.view.containerEl.doc !== document) leaf.detach();
		});
	});
	await sleep(500);
	result.errors = errors;
	return result;
};
