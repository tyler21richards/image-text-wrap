// Live Preview stand-ins in the cases verification found wrong (src/live-preview/stand-ins.ts).
//
//   node scripts/obsidian.mjs run tests/e2e/lp-stand-in-cases.mjs
//
// 1. Jumps to a line beside a tall wrapped picture, through CodeMirror's scrollIntoView with y "start"
//    (what jump to a line, heading links and search do): the line must end up at the window's top,
//    as with the plugin off. On "Stand-in stress.md" (written by tests/e2e/lp-scroll.mjs --stress)
//    line 37 beside the bottom of the 788px picture, after the picture was scrolled into view once;
//    on Fixture.md line 21 beside the 585px picture. Then Obsidian's "Navigate back" (app:go-back)
//    after real wheel scrolling put line 37 of the stress note at the top: it must come back there.
// 2. A link Obsidian does not draw as an image ("![a [b] c|wrap-right](...)" is plain text to it) gets
//    no stand-in while scrolling with real wheel input; the same link without the inner brackets does.
// 3. "Widest wrapped image" changed (50% to 30%, through updateSettings, as the slider does) while the
//    tall picture of Fixture.md shows through a stand-in: the stand-in takes the new width at once.
//    Then 40px steps up until the picture's own line is drawn, recording jumps over 2px.
// 4. The heading above the tall picture of Fixture.md folded: no copy of the hidden picture shows
//    while scrolling up from the end with real wheel input.
// 5. A picture never drawn in a new editor, landed beside with one scrollTop write: its copy is where
//    the picture will be, so nothing moves when it is drawn (real wheel input up).
// Every case with the plugin on; the jumps also with it off (disablePluginAndSave), as the control.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const STRESS = 'Stand-in stress.md';

/** Runs in the page: scrollIntoView(line, start) after `pre` (a picture's line) was scrolled into view once. */
async function jumpTo({ lineNo, pre }) {
	const v = app.workspace.activeLeaf.view.editor.cm;
	const wait = (ms) => new Promise((r) => setTimeout(r, ms));
	v.dispatch({ selection: { anchor: 0 } });
	const p = v.state.doc.line(pre);
	for (let i = 0; i < 4; i++) {
		const s = v.scrollDOM.getBoundingClientRect();
		v.scrollDOM.scrollTop += v.documentTop + v.lineBlockAt(p.from).top - (s.top + 120);
		await wait(80);
	}
	v.scrollDOM.scrollTop = 0;
	await wait(400);
	const t = v.state.doc.line(lineNo);
	v.dispatch({ effects: v.constructor.scrollIntoView(t.from, { y: 'start' }) });
	await wait(800);
	for (const el of v.contentDOM.children) {
		try {
			if (el.classList.contains('cm-line') && v.posAtDOM(el) === t.from) return Math.round(el.getBoundingClientRect().top - v.scrollDOM.getBoundingClientRect().top);
		} catch {
			/* not a line of this editor */
		}
	}
	return null;
}

/** Runs in the page: where line `n` is against the editor's top, or null when it is not drawn. */
function lineTop(n) {
	const v = app.workspace.activeLeaf.view.editor?.cm;
	if (!v || v.state.doc.lines < n) return null;
	const from = v.state.doc.line(n).from;
	for (const el of v.contentDOM.children) {
		try {
			if (el.classList.contains('cm-line') && v.posAtDOM(el) === from) return Math.round(el.getBoundingClientRect().top - v.scrollDOM.getBoundingClientRect().top);
		} catch {
			/* not a line of this editor */
		}
	}
	return null;
}

export default async ({ page, openNote, setNote, getNote, setWindowSize, watchErrors }) => {
	const errors = watchErrors(page);
	await setWindowSize(page, 1280, 900);
	if (!(await page.evaluate((p) => !!app.vault.getAbstractFileByPath(p), STRESS))) {
		return `"${STRESS}" is missing: run tests/e2e/lp-scroll.mjs --stress --passes none first`;
	}
	const lines = [];
	const check = (ok, text) => lines.push(`${ok ? 'PASS' : 'FAIL'} ${text}`);
	const open = async (note) => {
		await openNote(page, 'Plain images.md', 'live');
		await openNote(page, note, 'live');
		await sleep(400);
	};

	// 1. Jumps, plugin on and off.
	const jumps = async () => {
		const out = {};
		await open(STRESS);
		out.stress37 = await page.evaluate(jumpTo, { lineNo: 37, pre: 27 });
		await open('Fixture.md');
		out.fixture21 = await page.evaluate(jumpTo, { lineNo: 21, pre: 12 });
		// Back in history, after real wheel scrolling put line 37 of the stress note at the top.
		await open(STRESS);
		await page.evaluate(() => app.workspace.activeLeaf.view.editor.cm.dispatch({ selection: { anchor: 0 } }));
		const box = await page.evaluate(() => {
			const r = app.workspace.activeLeaf.view.editor.cm.scrollDOM.getBoundingClientRect();
			return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
		});
		await page.mouse.move(box.x, box.y);
		for (let i = 0; i < 60; i++) {
			await page.mouse.wheel(0, 60);
			await sleep(40);
			const t = await page.evaluate(lineTop, 37);
			if (t !== null && t < 120) break;
		}
		await sleep(300);
		const t1 = await page.evaluate(lineTop, 37);
		if (t1 !== null) {
			await page.mouse.wheel(0, t1 - 2);
			await sleep(400);
		}
		out.backBefore = await page.evaluate(lineTop, 37);
		await openNote(page, 'Plain images.md', 'live');
		await sleep(400);
		await page.evaluate(() => app.commands.executeCommandById('app:go-back'));
		await sleep(1000);
		out.backAfter = await page.evaluate(lineTop, 37);
		return out;
	};
	const on = await jumps();
	await page.evaluate(() => app.plugins.disablePluginAndSave('image-text-wrap'));
	await sleep(500);
	let off;
	try {
		off = await jumps();
	} finally {
		await page.evaluate(() => app.plugins.enablePluginAndSave('image-text-wrap'));
		await sleep(500);
	}
	const near = (a, b) => a !== null && b !== null && Math.abs(a - b) <= 3;
	check(near(on.stress37, off.stress37), `jump to line 37 of the stress note: ${on.stress37}px from the top (plugin off ${off.stress37}px)`);
	check(near(on.fixture21, off.fixture21), `jump to line 21 of Fixture.md: ${on.fixture21}px from the top (plugin off ${off.fixture21}px)`);
	check(near(on.backAfter, off.backAfter), `back in history to line 37 (left at ${on.backBefore}px): ${on.backAfter}px (plugin off ${off.backAfter}px)`);

	// 2. A link Obsidian draws as text gets no stand-in; the same link drawn as an image does.
	const P = 'Filler text. The harbour wall was rebuilt three times in the last century, each time a little higher than the storm before it. There is a bakery near the church that opens at six.';
	for (const [variant, link] of [
		['text', '![a [b] c|wrap-right](images/tall.png)'],
		['image', '![a b c|wrap-right](images/tall.png)'],
	]) {
		const note = `Stand-in phantom ${variant}.md`;
		await setNote(page, note, ['# Phantom', '', 'Intro.', '', link, `Text after the line. ${P}`, '', ...Array.from({ length: 40 }, (_, i) => [`Filler ${i + 1}. ${P}`, '']).flat(), 'End.'].join('\n'));
		await open(note);
		await page.evaluate(() => {
			const v = app.workspace.activeLeaf.view.editor.cm;
			v.dispatch({ selection: { anchor: 0 } });
			v.scrollDOM.scrollTop = 0;
		});
		await sleep(500);
		const box = await page.evaluate(() => {
			const r = app.workspace.activeLeaf.view.editor.cm.scrollDOM.getBoundingClientRect();
			return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
		});
		await page.mouse.move(box.x, box.y);
		// One fast flick down, then real 40px steps back up.
		await page.mouse.wheel(0, 800);
		await sleep(300);
		let framesWithStandIn = 0;
		for (let i = 0; i < 30; i++) {
			const shown = await page.evaluate(() => {
				const v = app.workspace.activeLeaf.view.editor.cm;
				const s = v.scrollDOM.getBoundingClientRect();
				return [...v.contentDOM.querySelectorAll('.itw-stand-in-float')].some((f) => {
					const r = f.getBoundingClientRect();
					return r.bottom > s.top && r.top < s.bottom;
				});
			});
			if (shown) framesWithStandIn++;
			await page.mouse.wheel(0, -40);
			await sleep(80);
		}
		if (variant === 'text') check(framesWithStandIn === 0, `a link Obsidian draws as text gets no stand-in (${framesWithStandIn} steps showed one)`);
		else check(framesWithStandIn > 0, `the same link drawn as an image does get one (${framesWithStandIn} steps)`);
	}

	// 3. "Widest wrapped image" changed while a stand-in shows.
	const setWidth = (w) =>
		page.evaluate(async (w) => {
			const p = app.plugins.plugins['image-text-wrap'];
			await p.updateSettings({ ...p.settings, maxWrapWidth: w });
		}, w);
	const saved = await page.evaluate(() => app.plugins.plugins['image-text-wrap'].settings.maxWrapWidth);
	try {
		await setWidth(50);
		await open('Fixture.md');
		const standIn = () =>
			page.evaluate(() => {
				const v = app.workspace.activeLeaf.view.editor.cm;
				const from = v.state.doc.line(12).from;
				const f = v.contentDOM.querySelector(`.itw-stand-in-float[data-from="${from}"]`);
				const r = f?.getBoundingClientRect();
				return r ? { width: Math.round(r.width), height: Math.round(r.height) } : null;
			});
		const found = await page.evaluate(async () => {
			const v = app.workspace.activeLeaf.view.editor.cm;
			const frames = (n) => new Promise((r) => { const s = (k) => (k ? requestAnimationFrame(() => s(k - 1)) : r()); s(n); });
			v.dispatch({ selection: { anchor: 0 } });
			for (let st = 0; st < v.scrollDOM.scrollHeight; st += 200) {
				v.scrollDOM.scrollTop = st;
				await frames(2);
			}
			v.scrollDOM.scrollTop = v.scrollDOM.scrollHeight;
			await frames(3);
			const from = v.state.doc.line(12).from;
			for (let i = 0; i < 200; i++) {
				v.scrollDOM.scrollTop -= 40;
				await frames(2);
				await new Promise((r) => setTimeout(r, 30));
				const f = v.contentDOM.querySelector(`.itw-stand-in-float[data-from="${from}"]`);
				const s = v.scrollDOM.getBoundingClientRect();
				if (f && f.getBoundingClientRect().bottom > s.top && f.getBoundingClientRect().top < s.bottom) return true;
				if (v.scrollDOM.scrollTop === 0) return false;
			}
			return false;
		});
		if (!found) check(false, 'width change: the tall picture never showed through a stand-in');
		else {
			const before = await standIn();
			await setWidth(30);
			await sleep(400);
			const after = await standIn();
			check(!!after && Math.abs(after.width - 210) <= 1, `width change: the stand-in goes from ${JSON.stringify(before)} to ${JSON.stringify(after)} at once (30% of 700px is 210px)`);
			const jumpsUp = await page.evaluate(async () => {
				const v = app.workspace.activeLeaf.view.editor.cm;
				const frames = (n) => new Promise((r) => { const s = (k) => (k ? requestAnimationFrame(() => s(k - 1)) : r()); s(n); });
				const from = v.state.doc.line(12).from;
				const out = [];
				let drawnSteps = 0;
				for (let i = 0; i < 80 && drawnSteps < 3; i++) {
					const s = v.scrollDOM.getBoundingClientRect();
					const before = [...v.contentDOM.querySelectorAll(':scope > .cm-line')].filter((el) => !el.querySelector('.image-embed')).map((el) => [el, el.getBoundingClientRect().top]).filter(([, t]) => t > s.top && t < s.bottom);
					const st = v.scrollDOM.scrollTop;
					v.scrollDOM.scrollTop = st - 40;
					await frames(2);
					await new Promise((r) => setTimeout(r, 30));
					const moved = v.scrollDOM.scrollTop - st;
					let worst = 0;
					for (const [el, t] of before) if (el.isConnected) { const e = el.getBoundingClientRect().top - (t - moved); if (Math.abs(e) > Math.abs(worst)) worst = e; }
					if (Math.abs(worst) > 2) out.push({ at: Math.round(st), px: Math.round(worst * 10) / 10 });
					const drawn = [...v.contentDOM.querySelectorAll('.image-embed')].some((e) => { try { return v.posAtDOM(e) === from && !e.closest('.itw-stand-in'); } catch { return false; } });
					if (drawn) drawnSteps++;
					if (v.scrollDOM.scrollTop === 0) break;
				}
				return out;
			});
			// CodeMirror keeps the heights it measured for lines not drawn at the time, so the lines beside
			// the picture can still move by one text line the first time they are drawn again.
			const worst = jumpsUp.reduce((m, j) => Math.max(m, Math.abs(j.px)), 0);
			check(worst <= 25, `width change: scrolling back to the picture, jumps ${JSON.stringify(jumpsUp)} (120px before the fix)`);
		}
	} finally {
		await setWidth(saved);
	}

	// 4. A folded heading hides the tall picture of Fixture.md (line 12, under the heading on line 10):
	// scrolling up from the end with real wheel input, no copy of it may show after the fold.
	await open('Fixture.md');
	const fold = () =>
		page.evaluate(async () => {
			const view = app.workspace.activeLeaf.view;
			view.editor.setCursor({ line: 9, ch: 0 });
			await new Promise((r) => setTimeout(r, 100));
			app.commands.executeCommandById('editor:toggle-fold');
			await new Promise((r) => setTimeout(r, 300));
			const v = view.editor.cm;
			const heading = v.lineBlockAt(v.state.doc.line(10).from);
			return heading.to >= v.state.doc.line(12).to;
		});
	const folded = await fold();
	try {
		await page.evaluate(() => {
			const v = app.workspace.activeLeaf.view.editor.cm;
			v.dispatch({ selection: { anchor: v.state.doc.length } });
			v.scrollDOM.scrollTop = v.scrollDOM.scrollHeight;
		});
		await sleep(400);
		const box = await page.evaluate(() => {
			const r = app.workspace.activeLeaf.view.editor.cm.scrollDOM.getBoundingClientRect();
			return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
		});
		await page.mouse.move(box.x, box.y);
		let copies = 0;
		for (let i = 0; i < 200; i++) {
			await page.mouse.wheel(0, -40);
			await sleep(60);
			const state = await page.evaluate(() => {
				const v = app.workspace.activeLeaf.view.editor.cm;
				return { copy: !!v.contentDOM.querySelector(`.itw-stand-in-float[data-from="${v.state.doc.line(12).from}"]`), top: v.scrollDOM.scrollTop };
			});
			if (state.copy) copies++;
			if (state.top === 0) break;
		}
		check(folded && copies === 0, `a picture inside a folded section gets no copy (folded: ${folded}; ${copies} steps showed one; 25 on the build before the fix)`);
	} finally {
		if (folded) await fold();
	}

	// 5. A picture never drawn in an editor: "Stand-in stress.md" opened in a new tab and dragged (one
	// scrollTop write) to beside the lower part of its 788px picture, then real 40px wheel ticks up. When
	// the picture's line is drawn, the picture must not move against the text, and no text may jump
	// (the picture moved 92px against the text and the text jumped 72px before the fix).
	const fresh = await page.evaluate(async (note) => {
		const leaf = app.workspace.getLeaf('tab');
		await leaf.openFile(app.vault.getAbstractFileByPath(note), { state: { mode: 'source', source: false }, active: true });
		await new Promise((r) => setTimeout(r, 700));
		const v = leaf.view.editor.cm;
		v.dispatch({ selection: { anchor: 0 } });
		v.scrollDOM.scrollTop = 0;
		await new Promise((r) => setTimeout(r, 300));
		v.scrollDOM.scrollTop = 2500;
		await new Promise((r) => setTimeout(r, 900));
		window.__itwFresh = leaf;
		const r = v.scrollDOM.getBoundingClientRect();
		return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
	}, STRESS);
	const snap = () =>
		page.evaluate(() => {
			const v = window.__itwFresh.view.editor.cm;
			const s = v.scrollDOM.getBoundingClientRect();
			const from = v.state.doc.line(27).from;
			const lines = [];
			for (const el of v.contentDOM.querySelectorAll(':scope > .cm-line')) {
				const r = el.getBoundingClientRect();
				if (el.querySelector('.image-embed') || r.bottom < s.top || r.top > s.bottom) continue;
				try {
					lines.push([v.posAtDOM(el), r.top, r.height]);
				} catch {
					/* not a line of this editor */
				}
			}
			const real = [...v.contentDOM.querySelectorAll('.image-embed')].find((e) => { try { return !e.closest('.itw-stand-in') && v.posAtDOM(e) === from; } catch { return false; } });
			const copy = v.contentDOM.querySelector(`.itw-stand-in-float[data-from="${from}"]`);
			const pic = real ?? copy;
			return { scrollTop: v.scrollDOM.scrollTop, lines, kind: real ? 'real' : copy ? 'copy' : null, bottom: pic ? pic.getBoundingClientRect().bottom : null };
		});
	await page.mouse.move(fresh.x, fresh.y);
	let prev = await snap();
	let worstText = 0;
	let switchMove = null;
	const firstKind = prev.kind;
	for (let i = 0; i < 40 && prev.scrollTop > 0; i++) {
		await page.mouse.wheel(0, -40);
		await sleep(80);
		const next = await snap();
		// The text's own movement: the most common move of lines drawn in both.
		const moves = next.lines.map(([pos, top, h]) => { const p = prev.lines.find((l) => l[0] === pos); return p && Math.abs(p[2] - h) < 1 ? Math.round(top - p[1]) : null; }).filter((m) => m !== null);
		const counts = new Map();
		for (const m of moves) counts.set(m, (counts.get(m) ?? 0) + 1);
		const scroll = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
		for (const m of moves) worstText = Math.max(worstText, Math.abs(m - scroll));
		if (prev.kind === 'copy' && next.kind === 'real' && prev.bottom !== null && next.bottom !== null) switchMove = Math.round(next.bottom - prev.bottom - scroll);
		prev = next;
	}
	await page.evaluate(() => window.__itwFresh.detach());
	check(
		firstKind === 'copy' && switchMove !== null && Math.abs(switchMove) <= 2 && worstText <= 2,
		`a picture never drawn: landing beside it shows a copy (${firstKind}); when it is drawn it moves ${switchMove}px against the text, and text moves at most ${worstText}px against the scroll`,
	);

	lines.push(`console errors ${errors.length}`);
	return lines.join('\n');
};
