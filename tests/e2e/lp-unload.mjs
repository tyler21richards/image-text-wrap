// Disabling and enabling the plugin in Live Preview (milestone M1: "Disabling the plugin leaves a
// normal image at its stored width"; brief 10: unload removes every class the plugin added).
//
//   node scripts/obsidian.mjs run tests/e2e/lp-unload.mjs
//
// On test-vault/Fixture.md at 1280x900, with a stand-in showing (the tall picture's own line scrolled
// out of the drawn range), the plugin is turned off the way the Settings toggle does it
// (disablePluginAndSave; disablePlugin alone leaves styles.css applied). Then: no element or class of
// the plugin is left, no picture floats, every picture has its stored width, and the plugin's style
// sheet is gone. Turned on again, the wrap and the stand-in come back. Three cycles.

export default async ({ page, openNote, setWindowSize, watchErrors }) => {
	const errors = watchErrors(page);
	const warnings = [];
	page.on('console', (m) => {
		if (/Measure loop|Viewport failed to stabilize/i.test(m.text())) warnings.push(m.text());
	});
	await setWindowSize(page, 1280, 900);
	await openNote(page, 'Plain images.md', 'live');
	await openNote(page, 'Fixture.md', 'live');

	/**
	 * From the end of the note, one jump to the bottom of the tall picture (line 12, 585px), whose own
	 * line CodeMirror then does not draw (it keeps ~500px above a jump): the picture shows through a
	 * stand-in. Returns the scroll position, or null when no stand-in shows.
	 */
	const toStandIn = () =>
		page.evaluate(async () => {
			const v = window.app.workspace.activeLeaf.view.editor.cm;
			const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
			v.dispatch({ selection: { anchor: 0 } });
			v.scrollDOM.scrollTop = v.scrollDOM.scrollHeight;
			await sleep(300);
			const from = v.state.doc.line(12).from;
			const s = v.scrollDOM.getBoundingClientRect();
			v.scrollDOM.scrollTop += v.lineBlockAt(from).top + 585 * 0.95 - (s.top - v.documentTop);
			await sleep(600);
			const f = v.contentDOM.querySelector(`.itw-stand-in-float[data-from="${from}"]`);
			return f && f.getBoundingClientRect().bottom > s.top ? v.scrollDOM.scrollTop : null;
		});

	/** What is on the page now: plugin traces, and every drawn picture's float and width. */
	const state = () =>
		page.evaluate(() => {
			const v = window.app.workspace.activeLeaf.view.editor.cm;
			const pictures = [];
			for (const e of v.contentDOM.querySelectorAll('.image-embed')) {
				let line = null;
				try {
					line = v.state.doc.lineAt(v.posAtDOM(e)).number;
				} catch {
					/* not in this editor */
				}
				const img = e.querySelector('img');
				pictures.push({
					line,
					float: getComputedStyle(e).float,
					width: Math.round(img.getBoundingClientRect().width),
					stored: Number(img.getAttribute('width')) || null,
				});
			}
			return {
				itwElements: document.querySelectorAll('[class*="itw-"]').length,
				standIns: document.querySelectorAll('.itw-stand-in').length,
				editorClass: v.dom.classList.contains('itw-has-wrap'),
				styleSheets: [...document.querySelectorAll('style')].filter((s) => /Image Text Wrap/.test(s.textContent ?? '')).length,
				maxWidthVar: document.body.style.getPropertyValue('--itw-max-width'),
				pictures,
			};
		});

	const cycles = [];
	for (let i = 0; i < 3; i++) {
		const at = await toStandIn();
		const on = await state();
		await page.evaluate(() => window.app.plugins.disablePluginAndSave('image-text-wrap'));
		await page.evaluate(() => new Promise((r) => setTimeout(r, 400)));
		const off = await state();
		await page.evaluate(() => window.app.plugins.enablePluginAndSave('image-text-wrap'));
		await page.evaluate(() => new Promise((r) => setTimeout(r, 600)));
		const again = await toStandIn();
		const back = await state();
		cycles.push({
			standInBefore: at !== null && on.standIns > 0,
			off: {
				itwElements: off.itwElements,
				editorClass: off.editorClass,
				styleSheets: off.styleSheets,
				maxWidthVar: off.maxWidthVar,
				floating: off.pictures.filter((p) => p.float !== 'none').length,
				notAtStoredWidth: off.pictures.filter((p) => p.stored && Math.abs(p.width - p.stored) > 1).map((p) => p),
				pictures: off.pictures.length,
			},
			backOn: { standIn: again !== null && back.standIns > 0, editorClass: back.editorClass, styleSheets: back.styleSheets },
		});
	}
	const pass = cycles.every(
		(c) =>
			c.standInBefore &&
			c.off.itwElements === 0 &&
			!c.off.editorClass &&
			c.off.styleSheets === 0 &&
			c.off.floating === 0 &&
			c.off.notAtStoredWidth.length === 0 &&
			c.backOn.standIn &&
			c.backOn.editorClass &&
			c.backOn.styleSheets === 1,
	);
	return { pass, cycles, errors, measureLoopWarnings: warnings.length };
};
