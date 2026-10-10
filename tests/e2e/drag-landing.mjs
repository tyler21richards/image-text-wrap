// Checks that the drop outline shows where the image will really be drawn, and that it is drawn there:
// - when an earlier image on the same side pushes it down (same-side floats stack),
// - when that earlier image is drawn only through its stand-in copy (its own line scrolled out of the drawn range),
// - when the move adds a blank line before it (a heading right after a paragraph),
// - when it is dragged down past the text it wraps (that text re-flows once it has left),
// - at the end of a note whose last line holds only a wrapped image (that line takes no height).
// Every gesture is real pointer input; page.evaluate only measures and sets up notes and scroll positions.
//
//   node scripts/obsidian.mjs run tests/e2e/drag-landing.mjs <screenshot dir> [case name ...]
// Prints one line per case: name, pass/fail, and the evidence.
import { mkdirSync } from 'node:fs';
import * as d from './drag-lib.mjs';

const SQUARE = 47; // ![[square.png|wrap-left|180]]
const QUOTE = 20; // > A quote ... (beside the tall right-hand image)
const RAIN = 7; // "Rain here..." (no float beside it)
const LANDSCAPE = 4; // ![[landscape.png|wrap-left|300]]

const NOTE = 'Drag landing.md';
const FILLER = 'The harbour wall was rebuilt three times in the last century, each time a little higher than the storm before it.';

/** A heading right after a paragraph, and a paragraph right under the heading; the square further down. */
const headingNote = () =>
	[
		'Intro paragraph, long enough to wrap onto a second line in the note column at this window width, with more words.',
		'## A heading right after it',
		'Under the heading, no blank line between them.',
		'',
		...Array.from({ length: 4 }, (_, i) => [`F${i} ${FILLER}`, '']).flat(),
		'![[square.png|wrap-left|120]]',
		'Text beside the square.',
		'',
		'Last paragraph.',
	].join('\n');

/** A tall right-hand picture with short paragraphs beside it, the square below them, and filler. */
const standInNote = () =>
	[
		'# Stand-in landing',
		'',
		...Array.from({ length: 30 }, (_, i) => [`F${i + 1} filler line of ordinary text, short enough for one line.`, '']).flat(),
		'![[tall.png|wrap-right|350]]',
		...Array.from({ length: 22 }, (_, i) => [`P${i + 1} short paragraph.`, '']).flat(),
		'![[square.png|wrap-right|200]]',
		...Array.from({ length: 30 }, (_, i) => [`S${i + 1} filler line of ordinary text, short enough for one line.`, '']).flat(),
	].join('\n');

/** Ends with a line holding only a wrapped image, and no newline after it. */
const endNote = () =>
	[
		'![[square.png|wrap-left|100]]',
		`First paragraph. ${FILLER}`,
		'',
		`Second paragraph. ${FILLER}`,
		'',
		'![[landscape.png|wrap-right|150]]',
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
	const slug = (s) => s.replace(/[^a-z0-9]+/gi, '-').toLowerCase();
	/** Equal to within a pixel (positions are read to a tenth of a pixel). */
	const near = (a, b) => a !== null && a !== undefined && b !== null && b !== undefined && Math.abs(a - b) < 1;
	const centre = (e) => ({ x: (e.img.left + e.img.right) / 2, y: (e.img.top + e.img.bottom) / 2 });
	/** Drags the image at `from` to `to`, and reports the indicator just before the release and the image after. */
	const dropAt = async (name, from, to, landedPrefix) => {
		await d.pressAndMove(page, from, to, 12);
		await d.sleep(120);
		await d.frames(page, 3);
		const during = await d.indicatorTops(page);
		await page.screenshot({ path: `${out}/landing-${slug(name)}-during.png` });
		await page.mouse.up();
		await d.sleep(1100);
		await d.frames(page, 3);
		const landed = await d.embedOf(page, landedPrefix);
		await page.screenshot({ path: `${out}/landing-${slug(name)}-after.png` });
		const at = during.box ?? during.bar;
		const error = landed && at !== null ? Math.round(landed.box.top - at) : null;
		return { during, landed, error };
	};

	// ---- Fixture: same-side floats stack, and no float in the way ----
	for (const [name, target, side] of [
		['beside the tall right image', QUOTE, 'right'],
		['no float in the way', RAIN, 'left'],
	]) {
		await run(name, async () => {
			await d.resetNote(page, null);
			await d.scrollToLine(page, SQUARE - 1, 40);
			const g = await d.geometry(page, SQUARE);
			const start = { x: g.img.left + g.img.width / 2, y: g.img.top + g.img.height / 2 };
			await page.mouse.move(start.x, start.y);
			await page.mouse.down();
			await page.mouse.move(start.x + 10, start.y + 10, { steps: 3 });
			const x = side === 'left' ? g.column.left + 60 : g.column.right - 60;
			// The target is far above: scroll up from the top edge until it is on screen.
			let y = await d.lineY(page, target);
			for (let i = 0; i < 300 && y < g.scroller.top + 150; i++) {
				await page.mouse.move(x, g.scroller.top + 4, { steps: 1 });
				await d.frames(page, 1);
				y = await d.lineY(page, target);
			}
			await page.mouse.move(x, (g.scroller.top + g.scroller.bottom) / 2, { steps: 3 });
			await d.sleep(150);
			y = await d.lineY(page, target);
			await page.mouse.move(x, y + 4, { steps: 6 });
			await d.frames(page, 3);
			const during = await d.indicatorTops(page);
			await page.screenshot({ path: `${out}/landing-${target}-during.png` });
			await page.mouse.up();
			await d.sleep(1100);
			await d.frames(page, 2);
			const landed = await d.embedOf(page, '![[square.png|wrap-');
			await page.screenshot({ path: `${out}/landing-${target}-after.png` });
			const error = landed && during.box !== null ? Math.round(landed.box.top - during.box) : null;
			return {
				pass: error === 0 && landed.line === target,
				evidence: `indicator "${during.label}" box at y=${during.box}; image drawn at y=${landed?.box.top} on line ${landed?.line} (target ${target}); off by ${error}px`,
			};
		});
	}

	// ---- Fixture: dragged down past the text it wraps; that text re-flows once the image has left ----
	await run('down past the text it wraps', async () => {
		await d.resetNote(page, null);
		await d.scrollToLine(page, LANDSCAPE - 1, 40);
		const g = await d.geometry(page, LANDSCAPE);
		const before = await d.lineTops(page, ['Rain here', '# Image Text Wrap fixture']);
		const rain = before['Rain here'];
		const r = await dropAt('down past the text it wraps', { x: g.img.left + g.img.width / 2, y: g.img.top + g.img.height / 2 }, { x: g.column.right - 60, y: rain + 4 }, '![[landscape.png');
		const after = await d.lineTops(page, ['Rain here']);
		return {
			pass: r.error === 0 && near(r.during.box, rain) && near(after['Rain here'], rain),
			evidence: `indicator "${r.during.label}" at y=${r.during.box} ("Rain here" at ${rain}); image drawn at y=${r.landed?.box.top} (off by ${r.error}px); "Rain here" after the drop at ${after['Rain here']}`,
		};
	});

	// ---- A heading right after a paragraph: the move adds a blank line before the image ----
	await run('heading right after a paragraph', async () => {
		await d.openText(page, h, NOTE, headingNote());
		const sq = await d.embedOf(page, '![[square.png');
		const g = await d.geometry(page);
		const before = await d.lineTops(page, ['## A heading', 'Intro paragraph']);
		const lineHeight = await page.evaluate(() => app.workspace.activeLeaf.view.editor.cm.defaultLineHeight);
		const r = await dropAt('heading right after a paragraph', centre(sq), { x: g.column.right - 60, y: before['## A heading'] + 4 }, '![[square.png');
		const after = await d.lineTops(page, ['Intro paragraph']);
		const text = (await d.noteText(page)).split('\n').slice(0, 4);
		const expected = Math.round((before['## A heading'] + lineHeight) * 10) / 10;
		return {
			pass: r.error === 0 && near(r.during.box, expected) && near(after['Intro paragraph'], before['Intro paragraph']) && text[1] === '' && text[2].startsWith('![[square.png|wrap-right'),
			evidence: `heading at y=${before['## A heading']}; indicator "${r.during.label}" at y=${r.during.box} (one ${lineHeight}px blank line lower: ${expected}); image drawn at y=${r.landed?.box.top} (off by ${r.error}px); intro paragraph ${before['Intro paragraph']} -> ${after['Intro paragraph']}; lines 0..3 ${JSON.stringify(text)}`,
		};
	});

	// ---- Beside a stand-in copy of a taller image on the same side ----
	await run('beside a stand-in copy', async () => {
		// A fresh editor: another note first, so nothing is left of the last one's measured heights.
		await openNote(page, d.FIXTURE, 'live');
		await d.openText(page, h, NOTE, standInNote());
		const tall = await d.lineStarting(page, '![[tall.png');
		// Scroll so the tall picture's own line is no longer drawn but its lower part is on screen (a stand-in).
		// One jump down from the top: CodeMirror then draws no lines above the screen.
		let copies = [];
		for (let attempt = 0; attempt < 3 && !copies.length; attempt++) {
			await page.evaluate((tall) => {
				const cm = app.workspace.activeLeaf.view.editor.cm;
				cm.scrollDOM.scrollTop = 0;
				requestAnimationFrame(() => {
					cm.scrollDOM.scrollTop = cm.lineBlockAt(cm.state.doc.line(tall + 1).from).top + 650;
				});
			}, tall);
			await d.sleep(600);
			await d.frames(page, 6);
			copies = (await d.standIns(page)).filter((s) => s.bottom > 100);
		}
		const sq = await d.embedOf(page, '![[square.png');
		const g = await d.geometry(page);
		if (!copies.length || !sq) return { pass: false, evidence: `no stand-in showing (${JSON.stringify(copies)}) or square not drawn` };
		const copyBottom = copies[0].bottom;
		// A paragraph whose top is beside the lower part of the copy.
		const tops = await d.lineTops(page, Array.from({ length: 22 }, (_, i) => `P${i + 1} `));
		const target = Object.entries(tops).find(([, y]) => y !== null && y > g.scroller.top + 60 && y < copyBottom - 40 && y > copyBottom - 110);
		if (!target) return { pass: false, evidence: `no paragraph beside the copy's lower part (copy bottom ${copyBottom})` };
		const r = await dropAt('beside a stand-in copy', centre(sq), { x: g.column.right - 60, y: target[1] + 6 }, '![[square.png');
		return {
			pass: r.error === 0 && r.during.box >= copyBottom,
			evidence: `stand-in copy of the tall picture ends at y=${copyBottom}; target "${target[0].trim()}" at y=${target[1]}; indicator "${r.during.label}" box at y=${r.during.box}; image drawn at y=${r.landed?.box.top} (off by ${r.error}px)`,
		};
	});

	// ---- The end of a note whose last line holds only a wrapped image ----
	await run('end of the note after a wrapped image line', async () => {
		await d.openText(page, h, NOTE, endNote());
		const sq = await d.embedOf(page, '![[square.png');
		const g = await d.geometry(page);
		const bottom = await d.lineY(page, 6);
		const r = await dropAt('end of the note after a wrapped image line', centre(sq), { x: g.column.right - 60, y: bottom + 150 }, '![[square.png');
		const lines = (await d.noteText(page)).split('\n');
		return {
			pass: r.error === 0 && lines.at(-1) === '![[square.png|wrap-right|100]]' && lines.at(-3) === '![[landscape.png|wrap-right|150]]',
			evidence: `pointer 150px below the note's last line (y=${bottom}); indicator "${r.during.label}" bar ${r.during.bar} box ${r.during.box}; image drawn at y=${r.landed?.box.top} (off by ${r.error}px); note ends ${JSON.stringify(lines.slice(-3))}`,
		};
	});

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
