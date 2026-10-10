// Reading view stand-ins in the cases verification found wrong (src/reading/stand-ins.ts).
//
//   node scripts/obsidian.mjs run tests/e2e/reading-stand-in-cases.mjs
//
// test-vault/Fixture.md in Reading view, scrolled down with real wheel input until Obsidian has taken
// the tall picture's own section off the page while the list, quote and callout it reaches are still
// there (each holds a stand-in). Then:
// 1. The paragraph glued to the picture is edited elsewhere while its section is off the page, so
//    Obsidian renders that section again into a new element:
//      "type"    real typing at its end in a Live Preview pane of the same note (split above);
//      "shorter" its last sentence removed through the vault (as sync or another plugin would).
//    The stand-ins must stay (moved by as much as the section's height changed), and scrolling back
//    up with real wheel input must not jump (96px to 120px before the fix).
// 2. "Widest wrapped image" changed (50% to 30%, through updateSettings, as the slider does): the
//    text at the window's top stays there, the stand-ins take the new width, and scrolling back up
//    does not jump (96px and 48px before the fix).
// The note and the setting are restored afterwards.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const NOTE = 'Fixture.md';

/** Runs in the page: the Reading view's state around the tall picture. */
function state() {
	const leaf = app.workspace.getLeavesOfType('markdown').find((l) => l.view.getMode() === 'preview');
	const view = leaf.view;
	const renderer = view.previewMode.renderer;
	const scroller = view.previewMode.containerEl.querySelector('.markdown-preview-view');
	const tall = renderer.sections.find((s) => s.el.querySelector('.image-embed[alt*="A tall picture"]'));
	const standIns = renderer.sections.flatMap((s) =>
		[...s.el.querySelectorAll('.itw-rv-stand-in')].map((x) => ({
			host: s.el.textContent.trim().slice(0, 16),
			width: x.style.getPropertyValue('--itw-stand-in-width'),
			height: x.style.getPropertyValue('--itw-stand-in-height'),
		})),
	);
	const s = scroller.getBoundingClientRect();
	const range = document.caretRangeFromPoint(s.left + s.width / 2 - 100, s.top + 6);
	const text = range ? (range.startContainer.textContent ?? '').slice(Math.max(0, range.startOffset - 10), range.startOffset + 20) : '';
	return { scroll: Math.round(scroller.scrollTop), tallAttached: !!tall?.el.isConnected, tallHeight: tall?.height ?? null, standIns, atTop: text };
}

/** Runs in the page: scrolls the Reading view up by `step` with scrollTop until the top, recording jumps over 2px. */
async function scrollUpJumps(step) {
	const view = app.workspace.getLeavesOfType('markdown').find((l) => l.view.getMode() === 'preview').view;
	const scroller = view.previewMode.containerEl.querySelector('.markdown-preview-view');
	const sizer = scroller.querySelector('.markdown-preview-sizer');
	const frames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
	const jumps = [];
	for (let i = 0; i < 500 && scroller.scrollTop > 0; i++) {
		const s = scroller.getBoundingClientRect();
		const anchors = [...sizer.children]
			.filter((el) => !el.classList.contains('markdown-preview-pusher') && el.getBoundingClientRect().height > 0 && el.getBoundingClientRect().top > s.top + 40 && el.getBoundingClientRect().bottom < s.bottom - 40)
			.slice(0, 8)
			.map((el) => [el, el.getBoundingClientRect().top]);
		const start = scroller.scrollTop;
		scroller.scrollTop = start - step;
		await frames();
		await new Promise((r) => setTimeout(r, 30));
		const moved = scroller.scrollTop - start;
		let worst = 0;
		for (const [el, top] of anchors) if (el.isConnected) { const e = el.getBoundingClientRect().top - (top - moved); if (Math.abs(e) > Math.abs(worst)) worst = e; }
		if (Math.abs(worst) > 2) jumps.push({ at: Math.round(start), px: Math.round(worst * 10) / 10 });
	}
	return jumps;
}

export default async ({ page, setWindowSize, watchErrors, getNote, setNote }) => {
	const errors = watchErrors(page);
	await setWindowSize(page, 1280, 900);
	const original = await getNote(page, NOTE);
	const saved = await page.evaluate(() => app.plugins.plugins['image-text-wrap'].settings.maxWrapWidth);
	const setWidth = (w) =>
		page.evaluate(async (w) => {
			const p = app.plugins.plugins['image-text-wrap'];
			await p.updateSettings({ ...p.settings, maxWrapWidth: w });
		}, w);
	const lines = [];
	const check = (ok, text) => lines.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);

	/** Opens the note (Live Preview above when `split`, Reading view below) and wheels down to the case. */
	const setUp = async (split) => {
		await setNote(page, NOTE, original);
		await page.evaluate(async (split) => {
			const old = app.workspace.getLeavesOfType('markdown');
			const file = app.vault.getAbstractFileByPath('Fixture.md');
			const top = app.workspace.getLeaf('tab');
			await top.openFile(file, { state: split ? { mode: 'source', source: false } : { mode: 'preview' }, active: true });
			old.forEach((l) => l.detach());
			if (split) await app.workspace.getLeaf('split', 'horizontal').openFile(file, { state: { mode: 'preview' } });
		}, split);
		await sleep(1200);
		const box = await page.evaluate(() => {
			const leaf = app.workspace.getLeavesOfType('markdown').find((l) => l.view.getMode() === 'preview');
			const r = leaf.view.previewMode.containerEl.querySelector('.markdown-preview-view').getBoundingClientRect();
			return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
		});
		await page.mouse.move(box.x, box.y);
		for (let i = 0; i < 150; i++) {
			const st = await page.evaluate(state);
			if (!st.tallAttached && st.scroll > 300 && st.standIns.length > 0) return st;
			await page.mouse.wheel(0, 40);
			await sleep(120);
		}
		return null;
	};

	try {
		await setWidth(50);
		// 1. Edits from elsewhere while the picture's section is off the page.
		for (const how of ['type', 'shorter']) {
			const before = await setUp(how === 'type');
			if (!before) {
				check(false, `${how}: the picture's section never left the page with stand-ins showing`);
				continue;
			}
			if (how === 'type') {
				await page.evaluate(() => {
					const leaf = app.workspace.getLeavesOfType('markdown').find((l) => l.view.getMode() === 'source');
					app.workspace.setActiveLeaf(leaf, { focus: true });
					const cm = leaf.view.editor.cm;
					for (let i = 1; i <= cm.state.doc.lines; i++) {
						const line = cm.state.doc.line(i);
						if (line.text.startsWith('When the fog comes in')) {
							cm.dispatch({ selection: { anchor: line.to } });
							break;
						}
					}
					cm.focus();
				});
				await sleep(300);
				await page.keyboard.type(' Extra words typed here.', { delay: 20 });
			} else {
				await page.evaluate(async () => {
					await app.vault.process(app.vault.getAbstractFileByPath('Fixture.md'), (text) =>
						text.split('\n').map((l) => (l.startsWith('When the fog comes in') ? l.replace(/[^.]*\.\s*$/, '') : l)).join('\n'),
					);
				});
			}
			await sleep(1500);
			const after = await page.evaluate(state);
			check(
				after.standIns.length === before.standIns.length && !after.tallAttached,
				`${how}: stand-ins kept while the picture's section is off the page (${before.standIns.length} before, ${after.standIns.length} after; section height ${before.tallHeight} to ${after.tallHeight}px; heights ${before.standIns.map((s) => s.height).join(' ')} to ${after.standIns.map((s) => s.height).join(' ')})`,
			);
			const box = await page.evaluate(() => {
				const leaf = app.workspace.getLeavesOfType('markdown').find((l) => l.view.getMode() === 'preview');
				const r = leaf.view.previewMode.containerEl.querySelector('.markdown-preview-view').getBoundingClientRect();
				return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
			});
			await page.mouse.move(box.x, box.y);
			const jumps = [];
			for (let i = 0; i < 200; i++) {
				const t0 = await page.evaluate(() => {
					const leaf = app.workspace.getLeavesOfType('markdown').find((l) => l.view.getMode() === 'preview');
					const sc = leaf.view.previewMode.containerEl.querySelector('.markdown-preview-view');
					const s = sc.getBoundingClientRect();
					window.__itwAnchors = [...sc.querySelector('.markdown-preview-sizer').children].filter((el) => !el.classList.contains('markdown-preview-pusher') && el.getBoundingClientRect().top > s.top + 20 && el.getBoundingClientRect().bottom < s.bottom - 20).slice(0, 8);
					return { st: sc.scrollTop, tops: window.__itwAnchors.map((el) => el.getBoundingClientRect().top) };
				});
				if (t0.st === 0) break;
				await page.mouse.wheel(0, -40);
				await sleep(150);
				const c = await page.evaluate((t0) => {
					const leaf = app.workspace.getLeavesOfType('markdown').find((l) => l.view.getMode() === 'preview');
					const sc = leaf.view.previewMode.containerEl.querySelector('.markdown-preview-view');
					const moved = sc.scrollTop - t0.st;
					let worst = 0;
					window.__itwAnchors.forEach((el, i) => { if (el.isConnected) { const e = el.getBoundingClientRect().top - (t0.tops[i] - moved); if (Math.abs(e) > Math.abs(worst)) worst = e; } });
					return { moved, worst: Math.round(worst * 10) / 10 };
				}, t0);
				if (Math.abs(c.worst) > 2) jumps.push({ at: Math.round(t0.st), px: c.worst });
				if (c.moved === 0) break;
			}
			check(jumps.length === 0, `${how}: scrolling back up with the wheel, jumps ${JSON.stringify(jumps)}`);
			await setNote(page, NOTE, original);
		}

		// 2. "Widest wrapped image" changed while a stand-in shows.
		const before = await setUp(false);
		if (!before) check(false, 'width change: the picture\'s section never left the page with stand-ins showing');
		else {
			await setWidth(30);
			await sleep(1000);
			const after = await page.evaluate(state);
			check(after.atTop === before.atTop, `width change: the text at the top stays ("${before.atTop}" then "${after.atTop}")`);
			check(after.standIns.length > 0 && after.standIns.every((s) => s.width === '210px'), `width change: stand-ins take the new width (${after.standIns.map((s) => s.width).join(' ') || 'none'})`);
			const jumps = await page.evaluate(scrollUpJumps, 40);
			check(jumps.length === 0, `width change: scrolling back up, jumps ${JSON.stringify(jumps)}`);
		}
	} finally {
		await page.evaluate(() => app.workspace.getLeavesOfType('markdown').slice(1).forEach((l) => l.detach()));
		await setNote(page, NOTE, original);
		await setWidth(saved);
	}
	lines.push(`note restored ${(await getNote(page, NOTE)) === original}, console errors ${errors.length}`);
	return lines.join('\n');
};
