// Checks that the view stays still around a drop (src/live-preview/keep-scroll.ts), in a real Obsidian:
// - a drop near the top of the editor, where CodeMirror's own scroll anchor sat under the new image,
// - a drop at the end of the note while scrolled to the very bottom (CodeMirror keeps the bottom still),
// - a drop below the text the image wrapped (that text re-flows once it has left),
// - undo and redo of a move come back to the view from before each,
// - navigating right after a drop or a layout change (a click in the Outline) is not undone by the hold.
// Every gesture is real pointer or keyboard input; page.evaluate only measures and sets up notes and scroll.
//
//   node scripts/obsidian.mjs run tests/e2e/drag-scroll.mjs <screenshot dir> [case name ...]
// Prints one line per case: name, pass/fail, and the evidence.
import { mkdirSync } from 'node:fs';
import * as d from './drag-lib.mjs';

const NOTE = 'Drag scroll.md';
const LANDSCAPE = 4; // ![[landscape.png|wrap-left|300]] in the fixture
const FILLER = 'The harbour wall was rebuilt three times in the last century, each time a little higher than the storm before it. There is a bakery near the church that opens at six.';

/** A tall right-hand picture with short paragraphs beside it, then the square, then filler. */
const tallNote = () =>
	[
		'# Drop near the top',
		'',
		'Intro paragraph that is not beside anything.',
		'',
		'![[tall.png|wrap-right|350]]',
		'P0 first line beside the tall picture.',
		'',
		...Array.from({ length: 22 }, (_, i) => [`P${i + 1} a short paragraph beside the tall picture.`, '']).flat(),
		'![[square.png|wrap-block|120]]',
		'Text below the square.',
		'',
		...Array.from({ length: 30 }, (_, i) => [`F${i} ${FILLER}`, '']).flat(),
	].join('\n');

/** The square a few paragraphs from the end; the note ends with short paragraphs. */
const endNote = (link) =>
	[
		'# Drop at the end',
		'',
		...Array.from({ length: 30 }, (_, i) => [`Filler ${i}. ${FILLER}`, '']).flat(),
		link,
		'Text beside the square near the end of the note.',
		...Array.from({ length: 4 }, (_, i) => ['', `Tail ${i + 1} short paragraph.`]).flat(),
		'',
	].join('\n');

export default async (h) => {
	const { page, setWindowSize, openNote, watchErrors, args } = h;
	const out = args[0] ?? '.';
	const only = args.slice(1);
	mkdirSync(out, { recursive: true });
	const errors = watchErrors(page);
	await setWindowSize(page, 1280, 900);
	await d.closeViewer(page);
	await openNote(page, d.FIXTURE, 'live');
	const results = [];
	const run = async (name, fn) => {
		if (only.length && !only.includes(name)) return;
		try {
			const r = await fn();
			results.push({ name, ...r });
		} catch (e) {
			results.push({ name, pass: false, evidence: `threw: ${e?.stack ?? e}` });
		}
		await page.mouse.up().catch(() => {});
		await page.keyboard.press('Escape').catch(() => {});
	};
	const near = (a, b) => a !== null && a !== undefined && b !== null && b !== undefined && Math.abs(a - b) < 1;
	const sameTops = (a, b) => Object.keys(a).every((k) => near(a[k], b[k]));
	const centre = (e) => ({ x: (e.img.left + e.img.right) / 2, y: (e.img.top + e.img.bottom) / 2 });
	const settle = async () => {
		await d.sleep(1100);
		await d.frames(page, 3);
	};
	/** Drags from `from` to `to` and releases; returns the indicator just before the release. */
	const dropAt = async (from, to, shot) => {
		await d.pressAndMove(page, from, to, 12);
		await d.sleep(120);
		await d.frames(page, 3);
		const during = await d.indicatorTops(page);
		await page.screenshot({ path: `${out}/scroll-${shot}-during.png` });
		await page.mouse.up();
		await settle();
		await page.screenshot({ path: `${out}/scroll-${shot}-after.png` });
		return during;
	};

	// ---- Near the top of the editor, then undo and redo ----
	await run('drop near the top of the editor, then undo and redo', async () => {
		await openNote(page, d.FIXTURE, 'live');
		await d.openText(page, h, NOTE, tallNote());
		const g = await d.geometry(page);
		// Scroll so a paragraph beside the tall picture sits 60 to 90px below the editor's top, the band where
		// CodeMirror's own anchor line is (its anchor is 8px below scrollTop, under the inline title).
		const p = 'P10 ';
		await page.evaluate((p) => {
			const cm = app.workspace.activeLeaf.view.editor.cm;
			const doc = cm.state.doc;
			for (let i = 1; i <= doc.lines; i++) {
				if (!doc.line(i).text.startsWith(p)) continue;
				const top = cm.lineBlockAt(doc.line(i).from).top + cm.documentTop + cm.scrollDOM.scrollTop;
				cm.scrollDOM.scrollTop = top - cm.scrollDOM.getBoundingClientRect().top - 70;
				break;
			}
		}, p);
		await d.sleep(500);
		await d.frames(page, 4);
		const watched = ['P5 ', 'P8 ', 'P9 ', p];
		const before = await d.lineTops(page, watched);
		const st0 = await d.scrollTop(page);
		const sq = await d.embedOf(page, '![[square.png');
		if (!sq || before[p] === null) return { pass: false, evidence: 'square or target not drawn' };
		const during = await dropAt(centre(sq), { x: g.column.right - 60, y: before[p] + 4 }, 'near-top');
		const landed = await d.embedOf(page, '![[square.png');
		const after = await d.lineTops(page, watched.slice(0, 3));
		const st1 = await d.scrollTop(page);
		const dropped = near(landed?.box.top, during.box) && sameTops(after, before);
		// Undo: the view from before the drop. Redo: the view from before the undo.
		await page.keyboard.press('Meta+z');
		await settle();
		const undone = await d.lineTops(page, watched);
		const st2 = await d.scrollTop(page);
		await page.keyboard.press('Meta+Shift+z');
		await settle();
		const redone = await d.embedOf(page, '![[square.png');
		const st3 = await d.scrollTop(page);
		return {
			pass: dropped && st1 === st0 && st2 === st0 && sameTops(undone, before) && st3 === st1 && near(redone?.box.top, landed?.box.top),
			evidence: `"${p.trim()}" ${Math.round(before[p] - g.scroller.top)}px below the editor top; indicator "${during.label}" box ${during.box}, image drawn at ${landed?.box.top}; scrollTop ${st0} -> ${st1}; lines above ${JSON.stringify(before)} -> ${JSON.stringify(after)}; undo: scrollTop ${st2}, lines ${JSON.stringify(undone)}; redo: scrollTop ${st3}, image at ${redone?.box.top}`,
		};
	});

	// ---- At the end of the note while scrolled to the very bottom ----
	for (const [kind, link] of [
		['wrapped', '![[square.png|wrap-left|120]]'],
		['in line', '![[square.png|120]]'],
	]) {
		await run(`end of the note while scrolled to the bottom (${kind})`, async () => {
			await d.openText(page, h, NOTE, endNote(link));
			for (let k = 0; k < 3; k++) {
				await page.evaluate(() => {
					const s = app.workspace.activeLeaf.view.editor.cm.scrollDOM;
					s.scrollTop = s.scrollHeight - s.clientHeight;
				});
				await d.sleep(250);
				await d.frames(page, 3);
			}
			const g = await d.geometry(page);
			const tail = 'Tail 4 ';
			const before = await d.lineTops(page, [tail, 'Tail 1 ']);
			const sq = await d.embedOf(page, '![[square.png');
			const end = await page.evaluate(() => {
				const cm = app.workspace.activeLeaf.view.editor.cm;
				return cm.lineBlockAt(cm.state.doc.length).bottom + cm.documentTop;
			});
			const during = await dropAt(centre(sq), { x: g.column.right - 60, y: Math.min(end + 20, g.scroller.bottom - 60) }, `end-${kind.replace(' ', '-')}`);
			const after = await d.lineTops(page, [tail]);
			const landed = await d.embedOf(page, '![[square.png');
			const lines = (await d.noteText(page)).split('\n');
			const at = during.box ?? during.bar;
			return {
				pass: near(landed?.box.top, at) && near(after[tail], before[tail]) && lines.at(-2)?.startsWith('![[square.png'),
				evidence: `indicator "${during.label}" at ${at}; image drawn at ${landed?.box.top}; "Tail 4" ${before[tail]} -> ${after[tail]}; note ends ${JSON.stringify(lines.slice(-3))}`,
			};
		});
	}

	// ---- Below the text it wrapped (the fixture), then undo ----
	await run('drop below the text it wrapped, then undo', async () => {
		await openNote(page, d.FIXTURE, 'live');
		await d.resetNote(page, null);
		await d.scrollToLine(page, LANDSCAPE - 1, 40);
		const g = await d.geometry(page, LANDSCAPE);
		// Text below the landing re-flows around the image, and text above the old place moves down by what the
		// image's leaving takes out (the landing is what stays); undo brings all of it back.
		const watched = ['Rain here', '## A heading beside', '# Image Text Wrap fixture'];
		const before = await d.lineTops(page, watched);
		const st0 = await d.scrollTop(page);
		const during = await dropAt({ x: g.img.left + g.img.width / 2, y: g.img.top + g.img.height / 2 }, { x: g.column.right - 60, y: before['Rain here'] + 4 }, 'below-wrapped');
		const landed = await d.embedOf(page, '![[landscape.png');
		const after = await d.lineTops(page, watched.slice(0, 1));
		await page.keyboard.press('Meta+z');
		await settle();
		const undone = await d.lineTops(page, watched);
		const st2 = await d.scrollTop(page);
		await d.resetNote(page, null);
		return {
			pass: near(landed?.box.top, during.box) && near(after['Rain here'], before['Rain here']) && st2 === st0 && sameTops(undone, before),
			evidence: `indicator "${during.label}" at ${during.box}; image drawn at ${landed?.box.top}; "Rain here" ${before['Rain here']} -> ${after['Rain here']}; undo: scrollTop ${st0} -> ${st2}, lines ${JSON.stringify(undone)} (before ${JSON.stringify(before)})`,
		};
	});

	// ---- Navigating right after a drop, or after a layout change, is not undone ----
	const outlineItem = async (text) =>
		page.evaluate((text) => {
			const el = [...document.querySelectorAll('.workspace-leaf-content[data-type="outline"] .tree-item-self')].find((e) => e.textContent.trim() === text);
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return { x: r.left + 30, y: r.top + r.height / 2 };
		}, text);
	const fillerOnScreen = () =>
		page.evaluate(() => {
			const cm = app.workspace.activeLeaf.view.editor.cm;
			const s = cm.scrollDOM.getBoundingClientRect();
			// With the cursor on it, Live Preview shows the heading's "## " too.
			const l = [...cm.contentDOM.querySelectorAll('.cm-line.HyperMD-header')].find((e) => /^(#+ )?Filler$/.test(e.textContent));
			if (!l) return false;
			const r = l.getBoundingClientRect();
			return r.bottom > s.top && r.top < s.bottom;
		});
	for (const how of ['a drop', 'a layout change']) {
		await run(`navigating right after ${how}`, async () => {
			await openNote(page, d.FIXTURE, 'live');
			await d.resetNote(page, null);
			const opened = await page.evaluate(async () => {
				if (!app.internalPlugins.plugins.outline?.enabled) return false;
				await app.commands.executeCommandById('outline:open');
				return true;
			});
			if (!opened) return { pass: false, evidence: 'the Outline core plugin is off' };
			await d.sleep(600);
			// Opening the Outline makes it the active leaf; the note's editor is the one being worked in.
			await page.evaluate(() => app.workspace.setActiveLeaf(app.workspace.getLeavesOfType('markdown')[0], { focus: true }));
			await d.sleep(300);
			await d.scrollToLine(page, LANDSCAPE - 1, 40);
			const g = await d.geometry(page, LANDSCAPE);
			const item = await outlineItem('Filler');
			if (!item) return { pass: false, evidence: 'no "Filler" heading in the Outline' };
			if (how === 'a drop') {
				const rain = (await d.lineTops(page, ['Rain here']))['Rain here'];
				await d.pressAndMove(page, { x: g.img.left + g.img.width / 2, y: g.img.top + g.img.height / 2 }, { x: g.column.right - 60, y: rain + 4 }, 10);
				await page.mouse.up();
			} else {
				await page.mouse.click(g.img.left + 60, g.img.top + 60);
				await d.sleep(400);
				const button = await page.evaluate(() => {
					const b = [...document.querySelectorAll('.itw-toolbar [aria-label]')].find((e) => e.getAttribute('aria-label') === 'Wrap text right');
					const r = b?.getBoundingClientRect();
					return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
				});
				if (!button) return { pass: false, evidence: 'no toolbar' };
				await page.mouse.click(button.x, button.y);
			}
			const st0 = await d.scrollTop(page);
			await d.sleep(150);
			await page.mouse.click(item.x, item.y);
			await settle();
			const st1 = await d.scrollTop(page);
			const shown = await fillerOnScreen();
			const changed = (await d.noteText(page)) !== d.fixtureText();
			await page.evaluate(() => app.workspace.getLeavesOfType('outline').forEach((l) => l.detach()));
			await page.evaluate(() => app.workspace.rightSplit.collapse());
			await openNote(page, d.FIXTURE, 'live');
			await d.resetNote(page, null);
			return {
				pass: changed && shown && st1 > st0 + 500,
				evidence: `${how} (note changed=${changed}), Outline click 150ms later: scrollTop ${st0} -> ${st1}, "Filler" heading on screen=${shown}`,
			};
		});
	}

	await openNote(page, d.FIXTURE, 'live');
	await d.resetNote(page, null);
	await page.evaluate((path) => {
		const f = app.vault.getAbstractFileByPath(path);
		if (f) return app.vault.delete(f);
	}, NOTE);
	const lines = results.map((r) => `${r.pass ? 'PASS' : 'FAIL'}  ${r.name}\n      ${r.evidence}`);
	if (errors.length) lines.push(`console errors: ${errors.join(' | ')}`);
	return lines.join('\n');
};
