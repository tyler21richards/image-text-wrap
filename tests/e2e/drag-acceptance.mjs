// M3 acceptance for drag to move, in a real Obsidian with real pointer and keyboard input.
//
//   node scripts/obsidian.mjs run tests/e2e/drag-acceptance.mjs <screenshot dir> [test name ...]
//
// Every gesture goes through page.mouse / page.keyboard (trusted CDP input). page.evaluate is only used
// to measure, to reset the note between tests, and to put the cursor somewhere neutral.
// Prints one line per test: name, pass/fail, and the evidence.
import { mkdirSync } from 'node:fs';
import * as d from './drag-lib.mjs';

const L = {
	landscape: 4, // ![[landscape.png|wrap-left|300]]
	rain: 7, // "Rain here..." paragraph
	heading: 9, // ## A heading beside a wrapped image
	tall: 11, // ![[tall.png|A tall picture|wrap-right|260]]
	list: 14, // - A list item ...
	nested: 15, // \t- A nested item
	secondItem: 18, // - The last top-level item.
	quote: 20, // > A quote ...
	callout: 22, // > [!note] A callout
	table: 29, // | Place | Picture |
	tableRow: 32, // | Lighthouse | Text only |
	code: 34, // ```js
	codeInside: 36, // function tide(hour) {
	math: 41, // $$
	squareWrapped: 47, // ![[square.png|wrap-left|180]]
	squarePlain: 50, // ![[square.png|180]]
	filler: 67, // ## Filler
};

export default async ({ page, setWindowSize, setNote, openNote, watchErrors, args }) => {
	const out = args[0] ?? '.';
	const only = args.slice(1);
	mkdirSync(out, { recursive: true });
	const errors = watchErrors(page);
	const results = [];
	const original = d.fixtureText();

	await setWindowSize(page, 1280, 900);
	await openNote(page, d.FIXTURE, 'live');

	const neutralCursor = () =>
		page.evaluate(() => {
			const cm = app.workspace.activeLeaf.view.editor.cm;
			cm.dispatch({ selection: { anchor: cm.state.doc.line(3).from } });
			cm.focus();
		});
	const reset = async (text = original) => {
		await page.keyboard.press('Escape').catch(() => {});
		await d.resetNote(page, setNote, text);
		await neutralCursor();
		await d.sleep(150);
	};
	const clean = (s) => s.bodyClasses.length === 0 && s.cursor === 'auto' && s.overlays === 0 && s.dimmed === 0;
	const imgCenter = (g) => ({ x: g.img.left + g.img.width / 2, y: g.img.top + g.img.height / 2 });
	const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
	const run = async (name, fn) => {
		if (only.length && !only.includes(name)) return;
		try {
			const r = await fn();
			results.push({ name, ...r });
		} catch (e) {
			results.push({ name, pass: false, evidence: `threw: ${e.stack ?? e}` });
		}
	};
	const selection = () => page.evaluate(() => app.workspace.activeLeaf.view.editor.cm.state.selection.main.head);
	const embedState = (line) =>
		page.evaluate((line) => {
			const cm = app.workspace.activeLeaf.view.editor.cm;
			const l = cm.state.doc.line(line + 1);
			for (const el of cm.contentDOM.querySelectorAll('.internal-embed.image-embed')) {
				let pos = -1;
				try {
					pos = cm.posAtDOM(el);
				} catch {}
				if (pos >= l.from && pos <= l.to) {
					const b = el.getBoundingClientRect();
					return {
						selected: el.classList.contains('is-selected'),
						float: getComputedStyle(el).float,
						left: Math.round(b.left),
						right: Math.round(b.right),
						top: Math.round(b.top),
						alt: el.getAttribute('alt'),
					};
				}
			}
			return null;
		}, line);
	/**
	 * Drags the image on `fromLine` to document line `toLine` (pointer 4px below that line's top), on the
	 * given side of the column. A far target is brought on screen by holding the pointer at the editor's
	 * edge (auto-scroll); then the pointer leaves the edge band, the scroll settles, and the line is
	 * measured again before the final approach.
	 */
	const dragTo = async (fromLine, toLine, side = 'left', { release = true, middle: toMiddle = false } = {}) => {
		const targetY = async () => (toMiddle ? d.blockMiddleY(page, toLine) : (await d.lineY(page, toLine)) + 4);
		await d.scrollToLine(page, Math.max(0, fromLine - 1), 40);
		const g = await d.geometry(page, fromLine);
		if (!g.img) throw new Error(`no image on line ${fromLine}`);
		const from = imgCenter(g);
		const x = side === 'left' ? g.column.left + 60 : g.column.right - 60;
		const middle = (g.scroller.top + g.scroller.bottom) / 2;
		const visible = (y) => y > g.scroller.top + 120 && y < g.scroller.bottom - 120;
		await page.mouse.move(from.x, from.y);
		await page.mouse.down();
		await page.mouse.move(from.x + 3, from.y + 3, { steps: 2 });
		await page.mouse.move(from.x + 10, from.y + 10, { steps: 2 });
		let y = await targetY();
		for (let i = 0; i < 300 && !visible(y); i++) {
			const edge = y > middle ? g.scroller.bottom - 4 : g.scroller.top + 4;
			await page.mouse.move(x, edge, { steps: 1 });
			await d.frames(page, 1);
			y = await targetY();
		}
		await page.mouse.move(x, middle, { steps: 3 });
		await d.sleep(150);
		await d.frames(page, 2);
		y = await targetY();
		await page.mouse.move(x, y, { steps: 8 });
		await d.frames(page, 3);
		const during = await d.dragState(page);
		if (!release) return { during, g };
		await page.mouse.up();
		await d.sleep(250);
		await d.frames(page, 2);
		return { during, g, after: await d.dragState(page) };
	};

	// ---- Obsidian's own behaviour is untouched ----

	await run('click selects', async () => {
		await reset();
		await d.scrollToLine(page, L.landscape - 1, 40);
		const g = await d.geometry(page, L.landscape);
		const p = imgCenter(g);
		await page.mouse.click(p.x, p.y);
		await d.sleep(250);
		const e = await embedState(L.landscape);
		const modSelected = await page.evaluate(() => !!document.querySelector('.mod-image-selected'));
		const unchanged = (await d.noteText(page)) === original;
		return { pass: !!e?.selected && modSelected && unchanged, evidence: `is-selected=${e?.selected} mod-image-selected=${modSelected} textUnchanged=${unchanged}` };
	});

	await run('second click opens the viewer', async () => {
		// Continues from the selection above.
		const g = await d.geometry(page, L.landscape);
		const p = imgCenter(g);
		await page.mouse.click(p.x, p.y);
		await d.sleep(500);
		const open = await page.evaluate(() => !!document.querySelector('.lightbox'));
		await shot('viewer-open');
		await page.keyboard.press('Escape');
		await d.sleep(500);
		const closed = await page.evaluate(() => !document.querySelector('.lightbox'));
		return { pass: open && closed, evidence: `lightbox after 2nd click=${open}, closed by Escape=${closed}` };
	});

	await run('corner still resizes', async () => {
		await reset();
		await d.scrollToLine(page, L.landscape - 1, 40);
		const g = await d.geometry(page, L.landscape);
		const start = { x: g.img.right - 8, y: g.img.bottom - 8 };
		await page.mouse.move(g.img.left + 20, g.img.top + 20);
		await page.mouse.move(start.x, start.y, { steps: 4 });
		await d.sleep(150);
		const target = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className, start);
		await page.mouse.down();
		await page.mouse.move(start.x - 25, start.y - 10, { steps: 5 });
		await page.mouse.move(start.x - 50, start.y - 20, { steps: 5 });
		await d.frames(page, 2);
		const during = await d.dragState(page);
		await page.mouse.up();
		await d.sleep(300);
		const text = await d.noteText(page);
		const line = text.split('\n')[L.landscape];
		const resized = /^!\[\[landscape\.png\|wrap-left\|(\d+)\]\]$/.exec(line);
		const ok = !!resized && Number(resized[1]) < 300 && !during.bar && during.bodyClasses.length === 0;
		return {
			pass: ok,
			evidence: `pressed on "${target}", line after: ${line}, our indicator during=${!!during.bar}, our body class during=${during.bodyClasses.join(',') || 'none'}`,
		};
	});

	// ---- Moving ----

	await run('drop on right half sets the side and re-wraps', async () => {
		await reset();
		const { during, after } = await dragTo(L.landscape, L.rain, 'right');
		const text = await d.noteText(page);
		const lines = text.split('\n');
		const at = lines.indexOf('![[landscape.png|wrap-right|300]]');
		const e = await embedState(at);
		await d.scrollToLine(page, at - 1, 60);
		await shot('drop-right');
		const ok =
			at === L.rain - 1 && lines[at + 1].startsWith('Rain here') && lines[at - 1] === '' && e?.float === 'right' && clean(after);
		return {
			pass: ok,
			evidence: `indicator "${during.label?.text}" box at x=${during.box?.left}; link now on line ${at}, next line "${lines[at + 1]?.slice(0, 20)}", rendered float=${e?.float}, embed x=${e?.left}..${e?.right}; clean after=${clean(after)}`,
		};
	});

	await run('one Cmd+Z restores the text exactly', async () => {
		// Continues from the move above (focus is on the editor after the drop).
		const focused = await page.evaluate(() => document.activeElement === app.workspace.activeLeaf.view.editor.cm.contentDOM);
		await page.keyboard.press('Meta+Z');
		await d.sleep(300);
		const text = await d.noteText(page);
		return { pass: text === original && focused, evidence: `editor focused after drop=${focused}; after one Cmd+Z text===original: ${text === original} (${d.changedLines(original, text).length} lines differ)` };
	});

	await run('drop on left half sets the side', async () => {
		await reset();
		const { during } = await dragTo(L.tall, L.rain, 'left');
		const text = await d.noteText(page);
		const lines = text.split('\n');
		const at = lines.indexOf('![[tall.png|A tall picture|wrap-left|260]]');
		const e = await embedState(at);
		await d.scrollToLine(page, at - 1, 60);
		await shot('drop-left');
		const ok = at === L.rain - 0 && lines[at + 1].startsWith('Rain here') && e?.float === 'left';
		return { pass: ok, evidence: `indicator "${during.label?.text}"; link on line ${at}: ${lines[at]}; next "${lines[at + 1]?.slice(0, 20)}"; float=${e?.float}` };
	});

	await run('same place, other half: only the side changes', async () => {
		await reset();
		await d.scrollToLine(page, L.landscape - 1, 40);
		const g = await d.geometry(page, L.landscape);
		const from = imgCenter(g);
		const y = await d.lineY(page, L.landscape);
		await d.pressAndMove(page, from, { x: g.column.right - 60, y: y + 4 }, 10);
		const during = await d.dragState(page);
		await page.mouse.up();
		await d.sleep(250);
		const changed = d.changedLines(original, await d.noteText(page));
		const ok = changed.length === 1 && changed[0][2] === '![[landscape.png|wrap-right|300]]';
		// And on the same side: nothing is offered, nothing written.
		await reset();
		await d.scrollToLine(page, L.landscape - 1, 40);
		const g2 = await d.geometry(page, L.landscape);
		const y2 = await d.lineY(page, L.landscape);
		await d.pressAndMove(page, imgCenter(g2), { x: g2.column.left + 60, y: y2 + 4 }, 10);
		const same = await d.dragState(page);
		await page.mouse.up();
		await d.sleep(250);
		const unchangedText = await d.noteText(page);
		const unchanged = unchangedText === original;
		return {
			pass: ok && !same.bar && unchanged,
			evidence: `other half: label "${during.label?.text}", changed lines ${JSON.stringify(changed)}; same half: indicator=${!!same.bar} ${same.label?.text ?? ''}, unchanged=${unchanged} ${unchanged ? '' : JSON.stringify(d.changedLines(original, unchangedText)).slice(0, 300)}`,
		};
	});

	await run('wrap off moves without wrapping', async () => {
		await reset();
		const { during } = await dragTo(L.squarePlain, L.filler, 'right');
		const text = await d.noteText(page);
		const lines = text.split('\n');
		const at = lines.indexOf('![[square.png|180]]');
		const e = await embedState(at);
		await d.scrollToLine(page, at - 2, 60);
		await shot('drop-unwrapped');
		const ok = lines[at - 1] === '' && lines[at + 1] === '' && lines[at + 2] === '## Filler' && e?.float === 'none' && !during.box;
		return { pass: ok, evidence: `indicator "${during.label?.text}" (box=${!!during.box}); lines ${at - 1}..${at + 2}: ${JSON.stringify(lines.slice(at - 1, at + 3))}; float=${e?.float}` };
	});

	// ---- Places an image cannot go ----

	// A table and a callout are drawn as one widget each: "inside" is the middle of the widget.
	for (const [name, line, middle] of [
		['inside the code block', L.codeInside, false],
		['inside the table', L.tableRow, true],
		['on a later list item', L.secondItem, false],
		['on a nested list item', L.nested, false],
		['inside the callout', L.callout + 1, true],
		['inside display math', L.math + 1, true],
	]) {
		await run(`invalid: ${name}`, async () => {
			await reset();
			await d.scrollToLine(page, L.squareWrapped - 1, 40);
			const { during, after } = await dragTo(L.squareWrapped, line, 'left', { middle });
			const unchanged = (await d.noteText(page)) === original;
			const pass = !during.bar && !during.box && unchanged && clean(after);
			if (!pass) await shot(`invalid-${line}`);
			return { pass, evidence: `indicator=${!!during.bar} label=${during.label?.text ?? 'none'}; text unchanged=${unchanged}; clean after=${clean(after)} cursor=${after.cursor}` };
		});
	}

	await run('invalid: frontmatter', async () => {
		// Shown as source lines, so there is frontmatter to point at (this vault's properties block has no height).
		const before = await page.evaluate(() => app.vault.getConfig('propertiesInDocument'));
		await page.evaluate(() => app.vault.setConfig('propertiesInDocument', 'source'));
		const withFrontmatter = `---\ntags: [fixture]\nstatus: draft\n---\n${original}`;
		try {
			await reset(withFrontmatter);
			await d.sleep(500);
			const { during, after } = await dragTo(L.landscape + 4, 1, 'left');
			await d.scrollToLine(page, 0, 0);
			const unchanged = (await d.noteText(page)) === withFrontmatter;
			return {
				pass: !during.bar && unchanged && clean(after),
				evidence: `pointer over the frontmatter line "tags: [fixture]": indicator=${!!during.bar}; unchanged=${unchanged}; clean=${clean(after)}`,
			};
		} finally {
			await page.evaluate((v) => app.vault.setConfig('propertiesInDocument', v), before);
		}
	});

	// ---- Cancelling ----

	await run('Esc cancels', async () => {
		await reset();
		const { during } = await dragTo(L.landscape, L.heading, 'right', { release: false });
		await page.keyboard.press('Escape');
		await d.frames(page, 2);
		const afterEsc = await d.dragState(page);
		const g = await d.geometry(page);
		await page.mouse.move(g.column.left + 200, g.scroller.top + 300, { steps: 3 });
		await page.mouse.up();
		await d.sleep(300);
		const after = await d.dragState(page);
		const unchanged = (await d.noteText(page)) === original;
		const lightbox = await page.evaluate(() => !!document.querySelector('.lightbox'));
		return {
			pass: !!during.bar && clean(afterEsc) && clean(after) && unchanged && !lightbox,
			evidence: `indicator before Esc=${!!during.bar}; right after Esc: classes=${afterEsc.bodyClasses.join(',') || 'none'} overlays=${afterEsc.overlays} cursor=${afterEsc.cursor}; after release: cursor=${after.cursor}, unchanged=${unchanged}, viewer opened=${lightbox}`,
		};
	});

	await run('cursor never stuck', async () => {
		await reset();
		const states = {};
		// After a drop.
		states.drop = (await dragTo(L.landscape, L.rain, 'right')).after;
		// After Esc (button still down, then released).
		await reset();
		await dragTo(L.landscape, L.rain, 'right', { release: false });
		await page.keyboard.press('Escape');
		await page.mouse.up();
		await d.sleep(250);
		states.esc = await d.dragState(page);
		// After an invalid drop.
		await reset();
		states.invalid = (await dragTo(L.squareWrapped, L.codeInside, 'left')).after;
		// After a drop outside this pane (over the sidebar).
		await reset();
		await d.scrollToLine(page, L.landscape - 1, 40);
		const g = await d.geometry(page, L.landscape);
		await d.pressAndMove(page, imgCenter(g), { x: 150, y: 300 }, 10);
		const outside = await d.dragState(page);
		await page.mouse.up();
		await d.sleep(250);
		states.outside = await d.dragState(page);
		const under = await page.evaluate(() => {
			const el = document.elementFromPoint(700, 400);
			return el ? getComputedStyle(el).cursor : null;
		});
		const isGrabbing = await page.evaluate(() => document.body.classList.contains('is-grabbing') || !!app.dragManager.draggable);
		const unchanged = (await d.noteText(page)) === original;
		const all = Object.values(states).every(clean);
		return {
			pass: all && !isGrabbing && under !== 'grabbing' && !outside.bar && unchanged,
			evidence: `${Object.entries(states).map(([k, s]) => `${k}: classes=[${s.bodyClasses}] cursor=${s.cursor} overlays=${s.overlays}`).join('; ')}; Obsidian's own drag (is-grabbing or dragManager.draggable)=${isGrabbing}; cursor of element at (700,400)=${under}; over sidebar indicator=${!!outside.bar}, dropped there unchanged=${unchanged}`,
		};
	});

	await run('during a drag: ghost, dimmed source, own cursor class, no tooltips, selection untouched', async () => {
		await reset();
		const before = await selection();
		const { during } = await dragTo(L.landscape, L.rain, 'right', { release: false });
		const extra = await page.evaluate(() => ({
			noTooltip: getComputedStyle(document.body).getPropertyValue('--no-tooltip').trim(),
			isGrabbing: document.body.classList.contains('is-grabbing'),
			cursorOverText: getComputedStyle(document.elementFromPoint(700, 500) ?? document.body).cursor,
		}));
		const mid = await selection();
		await shot('during-drag');
		await page.keyboard.press('Escape');
		await page.mouse.up();
		await d.sleep(200);
		const ok = !!during.ghost && during.dimmed === 1 && during.bodyClasses.includes('itw-dragging') && extra.noTooltip === 'true' && !extra.isGrabbing && before === mid;
		return {
			pass: ok,
			evidence: `ghost ${during.ghost?.width}x${during.ghost?.height} at (${during.ghost?.left},${during.ghost?.top}); dimmed=${during.dimmed}; body classes=${during.bodyClasses}; --no-tooltip=${extra.noTooltip}; is-grabbing=${extra.isGrabbing}; cursor over text=${extra.cursorOverText}; editor selection head ${before} -> ${mid}`,
		};
	});

	await run('auto-scroll near the edges', async () => {
		await reset();
		await d.scrollToLine(page, L.squareWrapped - 1, 200);
		const g = await d.geometry(page, L.squareWrapped);
		const start = g.scrollTop;
		await d.pressAndMove(page, imgCenter(g), { x: g.column.left + 100, y: g.scroller.bottom - 10 }, 8);
		await d.sleep(700);
		const down = (await d.geometry(page)).scrollTop;
		await page.mouse.move(g.column.left + 100, g.scroller.top + 10, { steps: 8 });
		await d.sleep(500);
		const up = (await d.geometry(page)).scrollTop;
		const during = await d.dragState(page);
		await page.mouse.move(g.column.left + 100, g.scroller.top + 300, { steps: 4 });
		await d.sleep(300);
		const still1 = (await d.geometry(page)).scrollTop;
		await d.sleep(300);
		const still2 = (await d.geometry(page)).scrollTop;
		await page.keyboard.press('Escape');
		await page.mouse.up();
		await d.sleep(200);
		const unchanged = (await d.noteText(page)) === original;
		return {
			pass: down > start + 100 && up < down - 100 && still1 === still2 && unchanged,
			evidence: `scrollTop ${Math.round(start)} -> held 10px above bottom 700ms -> ${Math.round(down)} -> held 10px below top 500ms -> ${Math.round(up)}; away from the edges it stays (${Math.round(still1)} == ${Math.round(still2)}); indicator while scrolling: ${during.label?.text ?? 'none'}`,
		};
	});

	// ---- Landing on each kind of block, in Live Preview and Reading view ----

	for (const [name, line, side] of [
		['heading', L.heading, 'right'],
		['list start', L.list, 'left'],
		['quote start', L.quote, 'right'],
		['callout start', L.callout, 'left'],
		['code block start', L.code, 'right'],
		['table start', L.table, 'left'],
		['end of note', null, 'right'],
	]) {
		await run(`lands on ${name}`, async () => {
			await reset();
			const target = line ?? original.split('\n').length;
			const { during } = await dragTo(L.squareWrapped, target, side);
			const text = await d.noteText(page);
			const lines = text.split('\n');
			const link = `![[square.png|wrap-${side}|180]]`;
			const at = lines.indexOf(link);
			const slug = name.replace(/\s+/g, '-');
			await d.scrollToLine(page, Math.max(0, at - 2), 80);
			await d.sleep(200);
			await shot(`lands-${slug}-live`);
			const live = await embedState(at);
			// Reading view.
			await openNote(page, d.FIXTURE, 'reading');
			await page.evaluate((at) => app.workspace.activeLeaf.view.previewMode.applyScroll(Math.max(0, at - 2)), at);
			await d.sleep(800);
			const reading = await page.evaluate(() => {
				const imgs = [...document.querySelectorAll('.workspace-leaf.mod-active .markdown-preview-view .image-embed')].filter((e) => /square/.test(e.getAttribute('src') ?? ''));
				return imgs.map((e) => ({ float: getComputedStyle(e).float, alt: e.getAttribute('alt'), parent: e.parentElement?.tagName, section: e.closest('.markdown-preview-sizer > div')?.className }));
			});
			await shot(`lands-${slug}-reading`);
			await openNote(page, d.FIXTURE, 'live');
			const expectedNext = line === null ? undefined : original.split('\n')[line];
			const glued = lines[at + 1] === expectedNext;
			const readingWrapped = reading.some((r) => r.float === side && r.alt === `wrap-${side}`);
			// At the end of the note the fixture's trailing newline is kept.
			const endOk = line === null ? at === lines.length - 2 && lines[at + 1] === '' : true;
			const pass = at > 0 && lines[at - 1] === '' && live?.float === side && readingWrapped && endOk;
			return {
				pass,
				evidence: `indicator "${during.label?.text}"; lines ${at - 1}..${at + 2}: ${JSON.stringify(lines.slice(at - 1, at + 3).map((s) => (s ?? '').slice(0, 40)))}; glued=${glued}; live float=${live?.float}; reading: ${JSON.stringify(reading)}`,
			};
		});
	}

	await reset();
	for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}\n      ${r.evidence}`);
	if (errors.length) console.log(`console errors: ${JSON.stringify(errors)}`);
	return undefined;
};
