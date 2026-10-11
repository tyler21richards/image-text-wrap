// Live Preview click, keyboard and alignment probe beside wrapped images (milestone M1).
//
//   node scripts/obsidian.mjs run tests/e2e/lp-click.mjs [--out file.json]
//
// On test-vault/Fixture.md at 1280x900, for every wrapped image: real mouse clicks (CDP
// Input.dispatchMouseEvent through playwright) on words beside the picture, near it, in the middle
// and at the far end of a line, and on a word right below it; each 1px before the boundary after
// the word's middle letter, so the cursor belongs exactly there. After each click:
//   - selection.main.head must equal view.posAtCoords() at the click point (taken before clicking),
//     and the DOM's own caret position there (document.caretRangeFromPoint);
//   - coordsAtPos(head) must be within 3px of the click (x) and contain its y (3px slack).
// Then ArrowDown / ArrowUp / ArrowRight from a word beside the picture, and typing two letters there
// (undone with one undo). Also the picture's top against the first wrapped line (glyph and line box).
// Finally the same clicks beside a stand-in: the tall picture's line scrolled out of the drawn range,
// with the stand-in widget checked too: no contenteditable on its root (so Obsidian's `contain: paint`
// for block widgets does not apply: computed contain none), contenteditable="false" on the element
// holding the copies, and the float reaching past the zero-height widget. After every click the DOM's
// caret must not be inside a stand-in. The note is restored at the end.
import { writeFileSync } from 'node:fs';

function installHelpers() {
	const view = () => window.app.workspace.activeLeaf.view.editor.cm;
	const frames = (n = 2) =>
		new Promise((resolve) => {
			const step = (k) => (k ? requestAnimationFrame(() => step(k - 1)) : resolve());
			step(n);
		});
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

	/** Word boxes in drawn text lines (not image lines), in screen pixels. */
	const words = () => {
		const v = view();
		const out = [];
		for (const line of v.contentDOM.children) {
			if (!line.classList.contains('cm-line') || line.querySelector('.image-embed')) continue;
			const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
			for (let node; (node = walker.nextNode()); ) {
				const text = node.textContent;
				const re = /[A-Za-z]{4,}/g;
				for (let m; (m = re.exec(text)); ) {
					const range = document.createRange();
					range.setStart(node, m.index);
					range.setEnd(node, m.index + m[0].length);
					const r = range.getBoundingClientRect();
					// The boundary after the word's middle letter: a click 1px before it should put the cursor there.
					const mid = document.createRange();
					const at = m.index + Math.floor(m[0].length / 2) - 1;
					mid.setStart(node, at);
					mid.setEnd(node, at + 1);
					const cut = mid.getBoundingClientRect().right;
					if (r.width > 0 && r.height > 0) out.push({ word: m[0], left: r.left, right: r.right, top: r.top, bottom: r.bottom, cut });
				}
			}
		}
		return out;
	};

	/** Puts the doc y `docY` at `offset` px below the window top, letting CodeMirror settle. */
	const scrollToDocY = async (docY, offset = 150) => {
		const v = view();
		for (let i = 0; i < 4; i++) {
			const s = v.scrollDOM.getBoundingClientRect();
			v.scrollDOM.scrollTop += docY - (s.top + offset - v.documentTop);
			await frames(2);
			await sleep(80);
		}
	};

	/** Wrapped image lines: { n, from, side }. */
	const images = () => {
		const v = view();
		const out = [];
		for (let n = 1; n <= v.state.doc.lines; n++) {
			const line = v.state.doc.line(n);
			const m = /^!\[.*wrap-(left|right)/.exec(line.text);
			if (m) out.push({ n, from: line.from, side: m[1] });
		}
		return out;
	};

	/** The drawn picture of an image line, real or stand-in. */
	const pictureRect = (from, standIn) => {
		const v = view();
		if (standIn) return v.contentDOM.querySelector(`.itw-stand-in-float[data-from="${from}"]`)?.getBoundingClientRect() ?? null;
		for (const e of v.contentDOM.querySelectorAll('.image-embed')) {
			if (e.closest('.itw-stand-in')) continue;
			try {
				if (v.posAtDOM(e) === from) return e.getBoundingClientRect();
			} catch {
				/* not in this view */
			}
		}
		return null;
	};

	/** Click targets beside and below a picture with rect `r` on `side`. */
	const targets = (r, side) => {
		const v = view();
		const s = v.scrollDOM.getBoundingClientRect();
		const all = words().filter((w) => w.top > s.top + 4 && w.bottom < s.bottom - 4);
		const beside = all.filter((w) => w.top >= r.top + 20 && w.bottom <= r.bottom - 10);
		const out = [];
		if (beside.length) {
			const byNear = [...beside].sort((a, b) => (side === 'left' ? a.left - b.left : b.right - a.right));
			out.push({ case: 'beside, next to the picture', ...byNear[0] });
			out.push({ case: 'beside, far end of the line', ...byNear[byNear.length - 1] });
			const mid = beside[Math.floor(beside.length / 2)];
			out.push({ case: 'beside, middle', ...mid });
		}
		const below = all.filter((w) => w.top > r.bottom + 1).sort((a, b) => a.top - b.top || a.left - b.left);
		if (below.length) {
			const firstTop = below[0].top;
			const row = below.filter((w) => Math.abs(w.top - firstTop) < 2);
			// A word under the picture's own column, proving the line below is full width again.
			const under = row.find((w) => w.right > r.left && w.left < r.right) ?? row[0];
			out.push({ case: 'right below the picture', ...under });
		}
		return out.map((t) => ({ ...t, x: Math.floor(t.cut) - 1, y: Math.round((t.top + t.bottom) / 2) }));
	};

	/** What CodeMirror and the DOM say is under (x, y), before clicking. */
	const expectAt = (x, y) => {
		const v = view();
		const cm = v.posAtCoords({ x, y });
		const caret = document.caretRangeFromPoint(x, y);
		let dom = null;
		try {
			if (caret) dom = v.posAtDOM(caret.startContainer, caret.startOffset);
		} catch {
			/* outside the content */
		}
		return { cm, dom };
	};

	/** Where the cursor is now and where CodeMirror draws it, and whether the DOM's caret is inside a stand-in. */
	const head = () => {
		const v = view();
		const h = v.state.selection.main.head;
		const c = v.coordsAtPos(h);
		const line = v.state.doc.lineAt(h);
		const sel = document.getSelection();
		const inStandIn = [sel.anchorNode, sel.focusNode].some((n) => !!n && !!(n.nodeType === 1 ? n : n.parentElement)?.closest('.itw-stand-in'));
		return { head: h, line: line.number, col: h - line.from, coords: c && { left: c.left, top: c.top, bottom: c.bottom }, inStandIn };
	};

	/**
	 * The stand-in widget of the picture at `from`: its root has no contenteditable (Obsidian gives a block
	 * widget's root with contenteditable="false" `contain: paint`, which would keep the float inside it),
	 * the element holding the copies is contenteditable="false", and the float reaches past the widget.
	 */
	const standInWidget = (from) => {
		const float = view().contentDOM.querySelector(`.itw-stand-in-float[data-from="${from}"]`);
		const root = float?.closest('.itw-stand-in');
		if (!root) return null;
		const copies = float.parentElement === root ? null : float.parentElement;
		const out = {
			rootContentEditable: root.getAttribute('contenteditable'),
			rootContain: getComputedStyle(root).contain,
			copiesContentEditable: copies?.getAttribute('contenteditable') ?? null,
			floatPastWidget: float.getBoundingClientRect().bottom > root.getBoundingClientRect().bottom + 1,
		};
		return { ...out, pass: out.rootContentEditable === null && out.rootContain === 'none' && out.copiesContentEditable === 'false' && out.floatPastWidget };
	};

	window.__lc = { view, frames, sleep, words, scrollToDocY, images, pictureRect, targets, expectAt, head, standInWidget };
}

export default async ({ page, openNote, setWindowSize, watchErrors, getNote, setNote, args }) => {
	const outIdx = args.indexOf('--out');
	const outFile = outIdx >= 0 ? args[outIdx + 1] : null;
	const errors = watchErrors(page);
	const warnings = [];
	page.on('console', (m) => {
		if (/Measure loop|Viewport failed to stabilize/i.test(m.text())) warnings.push(m.text());
	});
	await setWindowSize(page, 1280, 900);
	const original = await getNote(page, 'Fixture.md');
	await openNote(page, 'Plain images.md', 'live');
	await openNote(page, 'Fixture.md', 'live');
	await page.evaluate(installHelpers);

	const settle = () => page.evaluate(() => __lc.frames(3).then(() => __lc.sleep(120)));
	const results = { images: [], standIn: null };

	/** Clicks every target and checks where the cursor lands. */
	const clickAll = async (targets) => {
		const out = [];
		for (const t of targets) {
			const expected = await page.evaluate(({ x, y }) => __lc.expectAt(x, y), t);
			await page.mouse.click(t.x, t.y);
			await settle();
			const got = await page.evaluate(() => __lc.head());
			const c = got.coords;
			const dx = c ? Math.round(Math.abs(c.left - t.x) * 10) / 10 : null;
			const inY = c ? t.y >= c.top - 3 && t.y <= c.bottom + 3 : false;
			out.push({
				case: t.case,
				word: t.word,
				x: t.x,
				y: t.y,
				expectedCm: expected.cm,
				expectedDom: expected.dom,
				head: got.head,
				line: got.line,
				caretDx: dx,
				caretContainsY: inY,
				caretInStandIn: got.inStandIn,
				pass: got.head === expected.cm && (expected.dom === null || got.head === expected.dom) && dx !== null && dx <= 3 && inY && !got.inStandIn,
			});
		}
		return out;
	};

	const imgs = await page.evaluate(() => __lc.images());
	for (const img of imgs) {
		await page.evaluate(async (from) => {
			const v = __lc.view();
			await __lc.scrollToDocY(v.lineBlockAt(from).top, 120);
		}, img.from);
		await settle();
		const r = await page.evaluate((from) => __lc.pictureRect(from, false)?.toJSON() ?? null, img.from);
		if (!r) {
			results.images.push({ n: img.n, error: 'picture not drawn' });
			continue;
		}
		// Top of the picture against the first line beside it.
		const align = await page.evaluate((from) => {
			const v = __lc.view();
			const line = v.state.doc.lineAt(from);
			const next = v.state.doc.line(line.number + 1);
			const el = v.domAtPos(next.from).node;
			const lineEl = (el.nodeType === 1 ? el : el.parentElement).closest('.cm-line');
			const range = document.createRange();
			range.selectNodeContents(lineEl);
			const glyph = [...range.getClientRects()].find((b) => b.width > 0 && b.height > 0);
			const img = __lc.pictureRect(from, false);
			return {
				imageTop: img.top,
				firstGlyphTop: glyph?.top ?? null,
				firstLineBoxTop: lineEl.getBoundingClientRect().top,
				topVsGlyph: glyph ? Math.round((glyph.top - img.top) * 10) / 10 : null,
				topVsLineBox: Math.round((lineEl.getBoundingClientRect().top - img.top) * 10) / 10,
			};
		}, img.from);
		const targets = await page.evaluate(({ r, side }) => __lc.targets(r, side), { r, side: img.side });
		const clicks = await clickAll(targets);

		// Keys from a word beside the picture.
		const keys = [];
		const besideT = targets.find((t) => t.case.startsWith('beside'));
		if (besideT) {
			await page.mouse.click(besideT.x, besideT.y);
			await settle();
			const start = await page.evaluate(() => __lc.head());
			await page.keyboard.press('ArrowDown');
			await settle();
			const down = await page.evaluate(() => __lc.head());
			await page.keyboard.press('ArrowUp');
			await settle();
			const up = await page.evaluate(() => __lc.head());
			await page.keyboard.press('ArrowRight');
			await settle();
			const right = await page.evaluate(() => __lc.head());
			keys.push({
				start: start.head,
				down: { head: down.head, dy: Math.round(down.coords.top - start.coords.top), dx: Math.round(down.coords.left - start.coords.left) },
				upBack: up.head === start.head,
				rightIsPlusOne: right.head === start.head + 1,
				pass: down.coords.top - start.coords.top > 10 && down.coords.top - start.coords.top < 40 && Math.abs(down.coords.left - start.coords.left) < 12 && up.head === start.head && right.head === start.head + 1,
			});
			// Typing two letters there, then one undo.
			const before = await page.evaluate(() => __lc.view().state.doc.toString());
			const at = right.head;
			await page.keyboard.type('Zq');
			await settle();
			const typed = await page.evaluate(() => {
				const v = __lc.view();
				return { text: v.state.doc.toString(), head: v.state.selection.main.head };
			});
			const picAfterTyping = await page.evaluate((from) => __lc.pictureRect(from, false)?.toJSON() ?? null, img.from);
			await page.keyboard.press('Meta+z');
			await settle();
			const undone = await page.evaluate(() => __lc.view().state.doc.toString());
			keys.push({
				typedAt: at,
				inserted: typed.text.slice(at, at + 2),
				headAfter: typed.head,
				pictureStayed: !!picAfterTyping && Math.abs(picAfterTyping.top - r.top) < 1 && Math.abs(picAfterTyping.left - r.left) < 1,
				undoRestored: undone === before,
				pass: typed.text.slice(at, at + 2) === 'Zq' && typed.head === at + 2 && undone === before,
			});
		}
		results.images.push({ n: img.n, side: img.side, picture: { top: r.top, left: r.left, width: r.width, height: r.height }, align, clicks, keys });
	}

	// Beside a stand-in: put the cursor at the top, then scroll up from the end until the tall
	// picture shows through its stand-in, with its own line not drawn.
	await page.evaluate(async () => {
		const v = __lc.view();
		v.dispatch({ selection: { anchor: 0 } });
		v.scrollDOM.scrollTop = v.scrollDOM.scrollHeight;
		await __lc.frames(3);
		await __lc.sleep(200);
	});
	const tall = imgs.find((i) => i.n === 12) ?? imgs[0];
	const found = await page.evaluate(async (from) => {
		const v = __lc.view();
		for (let i = 0; i < 400; i++) {
			v.scrollDOM.scrollTop -= 40;
			await __lc.frames(2);
			await __lc.sleep(30);
			const s = v.scrollDOM.getBoundingClientRect();
			const r = __lc.pictureRect(from, true);
			if (r && r.bottom > s.top + 260 && !__lc.pictureRect(from, false)) return { rect: r.toJSON(), scrollTop: v.scrollDOM.scrollTop };
		}
		return null;
	}, tall.from);
	if (found) {
		const targets = await page.evaluate(({ r, side }) => __lc.targets(r, side), { r: found.rect, side: tall.side });
		const widget = await page.evaluate((from) => __lc.standInWidget(from), tall.from);
		const sel0 = await page.evaluate(() => __lc.head());
		// Clicking the stand-in itself does nothing.
		const onCopy = { x: Math.round(found.rect.left + found.rect.width / 2), y: Math.round(Math.max(found.rect.top, 120) + 60) };
		await page.mouse.click(onCopy.x, onCopy.y);
		await settle();
		const sel1 = await page.evaluate(() => __lc.head());
		const stillStandIn = await page.evaluate((from) => !!__lc.pictureRect(from, true), tall.from);
		const clicks = await clickAll(targets);
		// Typing beside the stand-in: the text re-flows around the copy, which stays; one undo restores.
		let typing = null;
		const besideT = targets.find((t) => t.case.startsWith('beside'));
		if (besideT) {
			await page.mouse.click(besideT.x, besideT.y);
			await settle();
			const before = await page.evaluate(() => __lc.view().state.doc.toString());
			const at = (await page.evaluate(() => __lc.head())).head;
			const copyBefore = await page.evaluate((from) => __lc.pictureRect(from, true)?.toJSON() ?? null, tall.from);
			await page.keyboard.type('Zq');
			await settle();
			const typed = await page.evaluate(() => __lc.view().state.doc.toString());
			const copyAfter = await page.evaluate((from) => __lc.pictureRect(from, true)?.toJSON() ?? null, tall.from);
			await page.keyboard.press('Meta+z');
			await settle();
			const undone = await page.evaluate(() => __lc.view().state.doc.toString());
			typing = {
				inserted: typed.slice(at, at + 2),
				copyStayed: !!copyBefore && !!copyAfter && Math.abs(copyAfter.top - copyBefore.top) < 1 && Math.abs(copyAfter.left - copyBefore.left) < 1,
				undoRestored: undone === before,
				pass: typed.slice(at, at + 2) === 'Zq' && undone === before && !!copyAfter,
			};
		}
		results.standIn = {
			image: tall.n,
			scrollTop: found.scrollTop,
			widget,
			clickOnCopy: { ...onCopy, selectionUnchanged: sel0.head === sel1.head, caretInStandIn: sel1.inStandIn, stillStandIn },
			clicks,
			typing,
		};
	} else {
		results.standIn = { error: 'no stand-in found while scrolling up' };
	}

	// Leave the note as it was.
	const now = await getNote(page, 'Fixture.md');
	if (now !== original) await setNote(page, 'Fixture.md', original);
	results.noteRestored = (await getNote(page, 'Fixture.md')) === original;
	results.errors = errors;
	results.measureLoopWarnings = warnings.length;
	if (outFile) writeFileSync(outFile, JSON.stringify(results, null, 2));

	const lines = [];
	for (const im of results.images) {
		if (im.error) {
			lines.push(`L${im.n}: ${im.error}`);
			continue;
		}
		lines.push(`L${im.n} ${im.side} ${Math.round(im.picture.width)}x${Math.round(im.picture.height)}: top vs first glyph ${im.align.topVsGlyph}px, vs first line box ${im.align.topVsLineBox}px`);
		for (const c of im.clicks) lines.push(`  click ${c.case} "${c.word}": head ${c.head} cm ${c.expectedCm} dom ${c.expectedDom} caret dx ${c.caretDx} ${c.pass ? 'PASS' : 'FAIL'}`);
		for (const k of im.keys) lines.push(`  ${'down' in k ? `arrows: down dy ${k.down.dy} dx ${k.down.dx}, up back ${k.upBack}, right +1 ${k.rightIsPlusOne}` : `typing: inserted "${k.inserted}", picture stayed ${k.pictureStayed}, one undo restores ${k.undoRestored}`} ${k.pass ? 'PASS' : 'FAIL'}`);
	}
	if (results.standIn?.clicks) {
		const s = results.standIn;
		const w = s.widget;
		lines.push(
			w
				? `stand-in widget of L${s.image}: root contenteditable ${w.rootContentEditable ?? 'none'}, contain ${w.rootContain}; copies contenteditable ${w.copiesContentEditable}; float reaches past the widget ${w.floatPastWidget} ${w.pass ? 'PASS' : 'FAIL'}`
				: `stand-in widget of L${s.image}: not found FAIL`,
		);
		lines.push(
			`beside the stand-in of L${s.image}: click on the copy leaves the selection ${s.clickOnCopy.selectionUnchanged ? 'unchanged' : 'CHANGED'} (still a stand-in: ${s.clickOnCopy.stillStandIn}; caret inside it: ${s.clickOnCopy.caretInStandIn})`,
		);
		for (const c of s.clicks) lines.push(`  click ${c.case} "${c.word}": head ${c.head} cm ${c.expectedCm} dom ${c.expectedDom} caret dx ${c.caretDx} ${c.pass ? 'PASS' : 'FAIL'}`);
		if (s.typing) lines.push(`  typing: inserted "${s.typing.inserted}", copy stayed ${s.typing.copyStayed}, one undo restores ${s.typing.undoRestored} ${s.typing.pass ? 'PASS' : 'FAIL'}`);
	} else lines.push(`stand-in: ${results.standIn?.error}`);
	lines.push(`note restored ${results.noteRestored}, console errors ${errors.length}, measure-loop warnings ${warnings.length}`);
	return lines.join('\n');
};
