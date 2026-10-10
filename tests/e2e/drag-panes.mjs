// Drag to move with more than one pane: a split below the note, and the note in a pop-out window.
//
//   node scripts/obsidian.mjs run tests/e2e/drag-panes.mjs <screenshot dir>
import { mkdirSync } from 'node:fs';
import * as d from './drag-lib.mjs';

const LANDSCAPE = 4;
const RAIN = 7;

export default async ({ page, setWindowSize, openNote, watchErrors, args }) => {
	const out = args[0] ?? '.';
	mkdirSync(out, { recursive: true });
	const errors = watchErrors(page);
	const original = d.fixtureText();
	const results = [];
	await setWindowSize(page, 1280, 900);
	await d.closeViewer(page);
	await openNote(page, d.FIXTURE, 'live');
	await d.resetNote(page, null);

	// ---- A split below: the pointer over the other pane offers nothing and does not scroll this one ----
	try {
		await page.evaluate(async () => {
			const fixture = app.workspace.activeLeaf;
			const below = app.workspace.getLeaf('split', 'horizontal');
			await below.openFile(app.vault.getAbstractFileByPath('Plain images.md'), { state: { mode: 'source', source: false } });
			window.__itwBelow = below;
			app.workspace.setActiveLeaf(fixture, { focus: true });
		});
		await d.sleep(600);
		await d.scrollToLine(page, LANDSCAPE - 1, 20);
		const g = await d.geometry(page, LANDSCAPE);
		const lower = await page.evaluate(() => {
			const b = window.__itwBelow.view.containerEl.getBoundingClientRect();
			return { top: b.top, bottom: b.bottom };
		});
		const from = { x: g.img.left + g.img.width / 2, y: g.img.top + g.img.height / 2 };
		await d.pressAndMove(page, from, { x: g.column.left + 200, y: lower.top + 150 }, 10);
		const t0 = (await d.geometry(page)).scrollTop;
		await d.sleep(500);
		const t1 = (await d.geometry(page)).scrollTop;
		const during = await d.dragState(page);
		await page.screenshot({ path: `${out}/split-over-other-pane.png` });
		// Back into this pane: offered again.
		const y = await d.lineY(page, RAIN);
		await page.mouse.move(g.column.right - 60, Math.min(y + 4, g.scroller.bottom - 60), { steps: 8 });
		await d.frames(page, 3);
		const back = await d.dragState(page);
		await page.keyboard.press('Escape');
		await page.mouse.up();
		await d.sleep(250);
		const unchanged = (await d.noteText(page)) === original;
		results.push({
			name: 'split: over the other pane nothing is offered and this pane does not scroll',
			pass: !during.bar && t0 === t1 && !!back.bar && unchanged,
			evidence: `over the lower pane (y ${Math.round(lower.top)}..${Math.round(lower.bottom)}): indicator=${!!during.bar}, scrollTop ${t0} -> ${t1} in 500ms; back over this pane: indicator "${back.label?.text ?? 'none'}"; Esc left the note unchanged=${unchanged}`,
		});
	} finally {
		await page.evaluate(() => window.__itwBelow?.detach());
		await d.sleep(300);
	}

	// ---- The note in a pop-out window ----
	let popout = null;
	try {
		const pagesBefore = new Set(page.context().pages());
		await page.evaluate(async () => {
			const leaf = app.workspace.openPopoutLeaf({ size: { width: 1100, height: 850 } });
			await leaf.openFile(app.vault.getAbstractFileByPath('Fixture.md'), { state: { mode: 'source', source: false }, active: true });
			window.__itwPopout = leaf;
		});
		for (let i = 0; i < 50 && !popout; i++) {
			await d.sleep(200);
			popout = page.context().pages().find((p) => !pagesBefore.has(p)) ?? null;
		}
		if (!popout) throw new Error('no pop-out page appeared over CDP');
		// Obsidian's drag manager lives in the main window and pop-outs relay drag events to it.
		const obsidianDrag = () =>
			page.evaluate(() => ({ grabbing: document.body.classList.contains('is-grabbing'), draggable: !!app.dragManager.draggable }));
		const cleanBefore = await obsidianDrag();
		if (cleanBefore.grabbing || cleanBefore.draggable) throw new Error(`Obsidian's drag state was dirty before the test: ${JSON.stringify(cleanBefore)}`);
		await d.sleep(1200);
		await popout.evaluate(() => window.electronWindow?.setBackgroundThrottling(false)).catch(() => {});
		const pd = {
			geometry: (line) =>
				popout.evaluate((line) => {
					// The pop-out shares the app; its active leaf is the note opened in it.
					const cm = app.workspace.activeLeaf.view.editor.cm;
					const r = (el) => el.getBoundingClientRect().toJSON();
					const from = cm.state.doc.line(line + 1).from;
					let img = null;
					for (const el of cm.contentDOM.querySelectorAll('.internal-embed.image-embed')) {
						if (cm.posAtDOM(el) === from) img = r(el.querySelector('img'));
					}
					return { img, column: r(cm.contentDOM), scroller: r(cm.scrollDOM), inThisWindow: cm.dom.ownerDocument === document };
				}, line),
		};
		const g = await pd.geometry(LANDSCAPE);
		if (!g.img || !g.inThisWindow) throw new Error(`pop-out editor not found in its own window: ${JSON.stringify(g)}`);
		const yRain = await popout.evaluate((line) => {
			const cm = app.workspace.activeLeaf.view.editor.cm;
			return cm.lineBlockAt(cm.state.doc.line(line + 1).from).top + cm.documentTop;
		}, RAIN);
		const from = { x: g.img.left + g.img.width / 2, y: g.img.top + g.img.height / 2 };
		await popout.mouse.move(from.x, from.y);
		await popout.mouse.down();
		await popout.mouse.move(from.x + 10, from.y + 10, { steps: 3 });
		await popout.mouse.move(g.column.right - 60, yRain + 4, { steps: 10 });
		await popout.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
		const during = await popout.evaluate(() => ({
			bar: !!document.querySelector('.itw-drop-bar:not(.is-hidden)'),
			label: document.querySelector('.itw-drop-label')?.textContent,
			ghost: !!document.querySelector('.itw-drag-ghost'),
			bodyClass: document.body.classList.contains('itw-dragging'),
		}));
		const mainHasOverlay = await page.evaluate(() => document.querySelectorAll('.itw-drag-ghost, .itw-drop-bar').length);
		await popout.screenshot({ path: `${out}/popout-during.png` });
		await popout.mouse.up();
		await d.sleep(400);
		const after = await popout.evaluate(() => ({
			text: app.workspace.activeLeaf.view.editor.cm.state.doc.toString(),
			overlays: document.querySelectorAll('.itw-drag-ghost, .itw-drop-bar, .itw-drop-box, .itw-drop-label').length,
			bodyClass: document.body.classList.contains('itw-dragging'),
			cursor: getComputedStyle(document.body).cursor,
			bodyClasses: [...document.body.classList].filter((c) => /grab|itw/.test(c)).join(' ') || 'none',
		}));
		await popout.screenshot({ path: `${out}/popout-after.png` });
		const mainAfter = await obsidianDrag();
		const changed = d.changedLines(original, after.text);
		const moved = changed.some(([, , a]) => a === '![[landscape.png|wrap-right|300]]');
		results.push({
			name: 'pop-out window: drag works there, overlays in that window',
			pass:
				during.bar && during.ghost && during.bodyClass && mainHasOverlay === 0 && moved && after.overlays === 0 && !after.bodyClass &&
				after.cursor === 'auto' && !mainAfter.grabbing && !mainAfter.draggable,
			evidence: `in the pop-out: indicator "${during.label}", ghost=${during.ghost}, body class=${during.bodyClass}; overlays in the main window=${mainHasOverlay}; moved to the right=${moved}; after: overlays=${after.overlays} class=${after.bodyClass} cursor=${after.cursor} (body: ${after.bodyClasses}); main window: is-grabbing=${mainAfter.grabbing}, Obsidian drag started=${mainAfter.draggable}`,
		});
	} catch (e) {
		results.push({ name: 'pop-out window: drag works there, overlays in that window', pass: false, evidence: `not run: ${e.message}` });
	} finally {
		await page.evaluate(() => window.__itwPopout?.detach()).catch(() => {});
		await d.sleep(500);
		await openNote(page, d.FIXTURE, 'live');
		await d.resetNote(page, null);
	}

	for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}\n      ${r.evidence}`);
	if (errors.length) console.log(`console errors: ${JSON.stringify(errors)}`);
	return undefined;
};
