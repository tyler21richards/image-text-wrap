// Live Preview scroll stability probe (brief 7 item 6, milestone M1).
//
//   node scripts/obsidian.mjs run tests/e2e/lp-scroll.mjs [--stress|--lines] [--disabled] [--out file.json] [--passes slow,fast,jump]
//
// Opens test-vault/Fixture.md (or with --stress "Stand-in stress.md", with --lines "Stand-in lines.md":
// tall pictures on a line of several and inside sentences; both notes are written by this probe) in
// Live Preview at 1280x900 and scrolls it the way Adjustable Media's
// probes did (docs/SCROLL_VALIDATION.md, MIT, (c) 2026 Yi-luo-hua): 40px steps top to bottom and back,
// waiting two animation frames + 30ms after each; a fast pass of 120px every 45ms; and jumps that put
// a wrapped image's lower half straight into view. After every step it records:
//   - jumps: visible editor lines whose top moved more than 2px against the actual scroll delta, or
//     whose height changed by more than 2px (a re-wrap);
//   - for every wrapped image whose float reaches into the window: whether its own line is drawn,
//     and whether any text intrudes into the image's area (the wrap is lost);
//   - height-map drift: every view.viewportLineBlocks entry against its .cm-line box (method from
//     image-rows-and-wraps tests/obsidian.mjs heightDrift(), MIT, (c) black-manthor).
// --disabled turns the plugin off first, as the Settings toggle does (control run), and back on at the end.
import { writeFileSync } from 'node:fs';

function installHelpers() {
	const view = () => window.app.workspace.activeLeaf.view.editor.cm;
	const frames = (n = 2) =>
		new Promise((resolve) => {
			const step = (k) => (k ? requestAnimationFrame(() => step(k - 1)) : resolve());
			step(n);
		});
	const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

	/** The .cm-line element CodeMirror draws for the line starting at `from`, if drawn. */
	const lineEl = (v, from) => {
		let found = null;
		for (const el of v.contentDOM.children) {
			if (!el.classList.contains('cm-line')) continue;
			let pos;
			try {
				pos = v.posAtDOM(el);
			} catch {
				continue;
			}
			if (pos === from) {
				found = el;
				break;
			}
		}
		return found;
	};

	/**
	 * Images wrapped left or right in the note's paragraphs: alone on their line, on a line of several,
	 * or inside a sentence. { n (line), from (the link), lineFrom, side }. Those that do not float (in a
	 * list item, say) are left out by calibrate.
	 */
	const images = () => {
		const v = view();
		const out = [];
		for (let n = 1; n <= v.state.doc.lines; n++) {
			const line = v.state.doc.line(n);
			if (!/wrap-(left|right)/.test(line.text) || /^(\s|#|>|[-*+] |\d+[.)] |\|)/.test(line.text)) continue;
			for (const m of line.text.matchAll(/!\[\[[^\]]*\]\]|!\[[^\]]*\]\([^)]*\)/g)) {
				const side = /\|wrap-(left|right)(\||\]|$)/.exec(m[0])?.[1];
				if (side) out.push({ n, from: line.from + m.index, lineFrom: line.from, side });
			}
		}
		return out;
	};

	/** The image embed CodeMirror draws for the link at `from`, if drawn. */
	const embedEl = (v, from) => {
		for (const embed of v.contentDOM.querySelectorAll('.image-embed')) {
			if (embed.closest('.itw-stand-in')) continue;
			try {
				if (v.posAtDOM(embed) === from) return embed;
			} catch {
				/* not in the document */
			}
		}
		return null;
	};

	const cal = new Map();

	/** Scrolls each wrapped image into view once and records its size, relative to its line's top. */
	const calibrate = async () => {
		const v = view();
		for (const img of images()) {
			for (let i = 0; i < 4; i++) {
				const s = v.scrollDOM.getBoundingClientRect();
				v.scrollDOM.scrollTop += v.documentTop + v.lineBlockAt(img.lineFrom).top - (s.top + 120);
				await frames(2);
				await sleep(60);
			}
			const embed = embedEl(v, img.from);
			if (!embed) continue;
			const r = embed.getBoundingClientRect();
			const c = v.contentDOM.getBoundingClientRect();
			const st = getComputedStyle(embed);
			if (st.float === 'none') continue;
			cal.set(img.from, {
				n: img.n,
				from: img.from,
				lineFrom: img.lineFrom,
				side: img.side,
				layoutTop: r.top - v.documentTop - v.lineBlockAt(img.lineFrom).top,
				w: r.width,
				h: r.height,
				left: r.left - c.left,
				right: r.right - c.left,
				gap: parseFloat(img.side === 'left' ? st.marginRight : st.marginLeft) || 0,
				marginBottom: parseFloat(st.marginBottom) || 0,
				float: st.float,
			});
		}
		return [...cal.values()];
	};

	/** Visible editor lines (not the image lines themselves), by document position. */
	const snapshot = () => {
		const v = view();
		const s = v.scrollDOM.getBoundingClientRect();
		const lines = [];
		for (const el of v.contentDOM.children) {
			if (!el.classList.contains('cm-line')) continue;
			const r = el.getBoundingClientRect();
			if (r.height <= 0 || r.bottom <= s.top || r.top >= s.bottom) continue;
			if (el.querySelector('.image-embed')) continue;
			let pos;
			try {
				pos = v.posAtDOM(el);
			} catch {
				continue;
			}
			lines.push({ pos, top: r.top, height: r.height });
		}
		return { scrollTop: v.scrollDOM.scrollTop, lines };
	};

	/** Lines from `before` that are still drawn and visible: how far each moved against the scroll. */
	const compare = (before) => {
		const v = view();
		const s = v.scrollDOM.getBoundingClientRect();
		const moved = v.scrollDOM.scrollTop - before.scrollTop;
		let worst = 0;
		let worstDh = 0;
		let count = 0;
		let first = null;
		for (const line of before.lines) {
			const el = lineEl(v, line.pos);
			if (!el) continue;
			const r = el.getBoundingClientRect();
			if (r.bottom <= s.top || r.top >= s.bottom) continue;
			const err = r.top - (line.top - moved);
			const dh = r.height - line.height;
			if (Math.abs(err) > 2 || Math.abs(dh) > 2) {
				count++;
				if (!first) first = { line: v.state.doc.lineAt(line.pos).number, err: Math.round(err * 10) / 10, dh: Math.round(dh * 10) / 10 };
			}
			if (Math.abs(err) > Math.abs(worst)) worst = err;
			if (Math.abs(dh) > Math.abs(worstDh)) worstDh = dh;
		}
		return { moved, worst: Math.round(worst * 10) / 10, worstDh: Math.round(worstDh * 10) / 10, count, first };
	};

	/**
	 * For each wrapped image whose float reaches into the drawn part of the note (from the first drawn
	 * line down to the window's bottom): is its own line drawn, and does text intrude on its area,
	 * anywhere drawn (`intrude`) or inside the window (`intrudeVisible`).
	 */
	const imageStatus = () => {
		const v = view();
		const s = v.scrollDOM.getBoundingClientRect();
		const c = v.contentDOM.getBoundingClientRect();
		const out = [];
		for (const img of images()) {
			const k = cal.get(img.from);
			if (!k) continue;
			const top = v.documentTop + v.lineBlockAt(img.lineFrom).top + k.layoutTop;
			const bottom = top + k.h;
			const firstTop = v.documentTop + v.lineBlockAt(v.viewport.from).top;
			if (bottom <= firstTop + 1 || top >= s.bottom) continue;
			const drawn = !!embedEl(v, img.from);
			// Text that overlaps the image area (plus its gap, less 1px) means the wrap is lost.
			const xFrom = c.left + k.left - (k.side === 'right' ? k.gap : 0) + 1;
			const xTo = c.left + k.right + (k.side === 'left' ? k.gap : 0) - 1;
			let intrude = 0;
			let intrudeVisible = 0;
			for (const line of v.contentDOM.children) {
				if (!line.classList.contains('cm-line') || line.querySelector('.image-embed')) continue;
				const lr = line.getBoundingClientRect();
				if (lr.bottom <= top || lr.top >= bottom) continue;
				const range = document.createRange();
				range.selectNodeContents(line);
				for (const b of range.getClientRects()) {
					if (b.width < 1 || b.height < 1) continue;
					if (b.bottom <= top + 1 || b.top >= bottom - 1) continue;
					if (b.right > xFrom && b.left < xTo) {
						intrude++;
						if (b.bottom > s.top && b.top < s.bottom) intrudeVisible++;
					}
				}
			}
			const visibleTop = Math.round(top - s.top);
			out.push({
				n: img.n,
				from: img.from,
				drawn,
				inWindow: bottom > s.top,
				intrude,
				intrudeVisible,
				visibleTop,
				standIn: !!v.contentDOM.querySelector(`.itw-stand-in-float[data-from="${img.from}"]`),
			});
		}
		return out;
	};

	/** image-rows-and-wraps heightDrift(): height map against drawn line boxes, worst px. */
	const heightDrift = () => {
		const v = view();
		let worst = 0;
		for (const block of v.viewportLineBlocks) {
			if (block.type !== 0 /* BlockType.Text */ && !Array.isArray(block.type)) continue;
			const el = lineEl(v, block.from);
			if (!el) continue;
			const rect = el.getBoundingClientRect();
			const d = Math.max(Math.abs(rect.top - v.documentTop - block.top), Array.isArray(block.type) ? 0 : Math.abs(rect.height - block.height));
			if (d > worst) worst = d;
		}
		return Math.round(worst * 10) / 10;
	};

	const measureStep = (before, extra) => {
		const cmp = compare(before);
		const imgs = imageStatus();
		return { ...extra, ...cmp, drift: heightDrift(), imgs };
	};

	/** Counts transactions on the current editor (a runaway plugin shows up here). */
	const counted = () => {
		const v = view();
		if (!v.dispatch.__itwCounted) {
			const orig = v.dispatch;
			const wrapped = function (...a) {
				window.__lpDispatches = (window.__lpDispatches ?? 0) + 1;
				return orig.apply(this, a);
			};
			wrapped.__itwCounted = true;
			v.dispatch = wrapped;
		}
		return window.__lpDispatches ?? 0;
	};

	/** Scroll from where we are by `step` until the end (dir 1) or the top (dir -1). */
	const scan = async ({ step, fast }) => {
		const v = view();
		const d0 = counted();
		const out = [];
		for (let i = 0; i < 2000; i++) {
			const sd = v.scrollDOM;
			// Stop at the end. (Not on "scrollTop did not change": CodeMirror's scroll anchoring can
			// undo a step exactly when lines above change height, which is itself a jump to record.)
			if (step > 0 ? sd.scrollTop >= sd.scrollHeight - sd.clientHeight - 1 : sd.scrollTop <= 0) break;
			const before = snapshot();
			const start = sd.scrollTop;
			sd.scrollTop = start + step;
			if (fast) await sleep(45);
			else {
				await frames(2);
				await sleep(30);
			}
			out.push(measureStep(before, { at: Math.round(start) }));
		}
		return { steps: out, dispatches: counted() - d0 };
	};

	/** Puts the doc y `docY` at the top of the window with one scrollTop write. */
	const jumpTo = (docY) => {
		const v = view();
		const s = v.scrollDOM.getBoundingClientRect();
		v.scrollDOM.scrollTop += docY - (s.top - v.documentTop);
	};

	const settle = async (ms = 300) => {
		await frames(3);
		await sleep(ms);
	};

	window.__lp = { view, frames, sleep, images, calibrate, snapshot, compare, imageStatus, heightDrift, measureStep, scan, jumpTo, settle, cal, lineEl, embedEl, counted };
}

/** Totals for a pass: an array of steps, or a scan's { steps, dispatches }. */
function summarize(pass) {
	const steps = Array.isArray(pass) ? pass : pass.steps;
	const jumps = steps.filter((s) => s.count > 0);
	const undrawnReaching = steps.filter((s) => s.imgs.some((i) => !i.drawn));
	const lost = steps.filter((s) => s.imgs.some((i) => i.intrudeVisible > 0));
	const lostDrawn = steps.filter((s) => s.imgs.some((i) => i.intrude > 0));
	const standIn = steps.filter((s) => s.imgs.some((i) => !i.drawn && i.standIn));
	return {
		steps: steps.length,
		jumps: jumps.length,
		maxJump: jumps.reduce((m, s) => Math.max(m, Math.abs(s.worst), Math.abs(s.worstDh)), 0),
		jumpList: jumps.map((s) => ({ at: s.at, px: s.worst, dh: s.worstDh, lines: s.count, first: s.first, imgs: s.imgs })),
		stepsWithUndrawnImageReaching: undrawnReaching.length,
		stepsWithStandIn: standIn.length,
		stepsWithLostWrap: lost.length,
		stepsWithLostWrapAboveWindow: lostDrawn.length - lost.length,
		lostWrapAt: lost.slice(0, 12).map((s) => ({ at: s.at, imgs: s.imgs })),
		maxDrift: steps.reduce((m, s) => Math.max(m, s.drift), 0),
		dispatches: Array.isArray(pass) ? null : pass.dispatches,
	};
}

const STRESS_NOTE = 'Stand-in stress.md';

/** A note with a 900px picture, two same-side pictures stacked, and one on the other side. */
function stressNote() {
	const filler = (n) =>
		Array.from(
			{ length: n },
			(_, i) =>
				`Filler paragraph ${i + 1}. The harbour wall was rebuilt three times in the last century, each time a little higher than the storm before it. There is a bakery near the church that opens at six and is usually sold out of bread by ten. A local saying holds that a red sky at noon means the kettle should go on early.`,
		).join('\n\n');
	return [
		'# Stand-in stress',
		'',
		filler(12),
		'',
		'![[tall.png|A very tall picture|wrap-right|400]]',
		filler(3),
		'',
		'- A list item beside the tall picture.',
		'\t- A nested item, long enough to wrap onto a second line beside the very tall picture on the right.',
		'',
		'> A quote beside the tall picture. The bus to the market town takes an hour and stops wherever someone happens to be waiting.',
		'',
		filler(8),
		'',
		'![[tall.png|wrap-left|240]]',
		'Text beside the first of two pictures on the left. Most gardens grow potatoes, runner beans, and at least one plant that nobody remembers planting.',
		'![[landscape.png|wrap-left|200]]',
		filler(2),
		'',
		'![[square.png|wrap-right|160]]',
		filler(14),
	].join('\n');
}

const LINES_NOTE = 'Stand-in lines.md';

/** "L12" for a picture alone on line 12, "L12+30" for one 30 characters into it. */
const label = (img) => (img.from === img.lineFrom ? `L${img.n}` : `L${img.n}+${img.from - img.lineFrom}`);

/**
 * Tall pictures that do not have a line of their own: two on one line (one each side, so the text runs
 * between them), and one inside a sentence, on the right and on the left.
 */
function linesNote() {
	const filler = (n, from = 1) =>
		Array.from(
			{ length: n },
			(_, i) =>
				`Paragraph ${i + from}. The ferry runs twice a week in winter, and the post arrives in a single canvas bag that smells faintly of diesel.`,
		).join('\n\n');
	return [
		'# Stand-in lines',
		'',
		filler(14),
		'',
		'![[tall.png|wrap-left|300]] ![[square.png|wrap-right|120]]',
		filler(8, 15),
		'',
		filler(14, 23),
		'',
		'Inside a sentence: the harbour wall ![[tall.png|wrap-right|300]] was rebuilt three times in the last century, each time a little higher than the storm before it, and the bakery near the church is sold out of bread by ten.',
		filler(8, 37),
		'',
		filler(14, 45),
		'',
		'A sentence that holds ![[tall.png|wrap-left|280]] a picture on the left, with the rest of the words flowing around it.',
		filler(8, 59),
		'',
		filler(16, 67),
	].join('\n');
}

export default async ({ page, openNote, setNote, setWindowSize, watchErrors, args }) => {
	const disabled = args.includes('--disabled');
	const outIdx = args.indexOf('--out');
	const outFile = outIdx >= 0 ? args[outIdx + 1] : null;
	const passIdx = args.indexOf('--passes');
	const passes = (passIdx >= 0 ? args[passIdx + 1] : 'slow,fast,jump').split(',');
	const note = args.includes('--stress') ? STRESS_NOTE : args.includes('--lines') ? LINES_NOTE : 'Fixture.md';

	const errors = watchErrors(page);
	// CodeMirror's own warnings when its measure cycle does not settle, by the phase they came in.
	const warnings = [];
	let phase = 'setup';
	page.on('console', (m) => {
		if (/Measure loop|Viewport failed to stabilize/i.test(m.text())) warnings.push({ phase, text: m.text() });
	});
	const inPhase = async (name, fn) => {
		phase = name;
		const out = await fn();
		phase = 'between';
		return out;
	};

	await setWindowSize(page, 1280, 900);
	if (note === STRESS_NOTE) await setNote(page, STRESS_NOTE, stressNote());
	if (note === LINES_NOTE) await setNote(page, LINES_NOTE, linesNote());
	// disablePluginAndSave is what the Settings toggle does. disablePlugin() alone unloads the code but
	// leaves styles.css applied (the plugin stays in enabledPlugins), so it is not a clean control.
	if (disabled) await page.evaluate(() => window.app.plugins.disablePluginAndSave('image-text-wrap'));
	await page.evaluate(installHelpers);
	// A fresh editor state: open another note, then the one under test, cursor at the start (or, with
	// --cursor-end, on the last line: CodeMirror draws the cursor's line even out of view, and a
	// heading drawn that way loses its heading style, which moves the note by 23px on its own).
	const cursorEnd = args.includes('--cursor-end');
	const reopen = async () => {
		await openNote(page, 'Plain images.md', 'live');
		await openNote(page, note, 'live');
		await page.evaluate(async (cursorEnd) => {
			const v = __lp.view();
			v.dispatch({ selection: { anchor: cursorEnd ? v.state.doc.length : 0 } });
			v.scrollDOM.scrollTop = 0;
			await __lp.settle(500);
		}, cursorEnd);
	};
	await reopen();
	// Calibration: each image's drawn size (with the plugin on, they are floats).
	const calibration = await page.evaluate(() => __lp.calibrate());
	await page.evaluate(async () => {
		__lp.view().scrollDOM.scrollTop = 0;
		await __lp.settle(500);
	});

	const result = { note, disabled, calibration, passes: {} };

	if (passes.includes('slow')) {
		const down = await inPhase('slowDown', () => page.evaluate(() => __lp.scan({ step: 40 })));
		const up = await inPhase('slowUp', () => page.evaluate(() => __lp.scan({ step: -40 })));
		const down2 = await inPhase('slowDown2', () => page.evaluate(() => __lp.scan({ step: 40 })));
		const up2 = await inPhase('slowUp2', () => page.evaluate(() => __lp.scan({ step: -40 })));
		result.passes.slowDown = summarize(down);
		result.passes.slowUp = summarize(up);
		result.passes.slowDown2 = summarize(down2);
		result.passes.slowUp2 = summarize(up2);
	}
	if (passes.includes('fast')) {
		await page.evaluate(async () => {
			__lp.view().scrollDOM.scrollTop = 0;
			await __lp.settle(300);
		});
		const down = await inPhase('fastDown', () => page.evaluate(() => __lp.scan({ step: 120, fast: true })));
		await page.evaluate(() => __lp.settle(300));
		const up = await inPhase('fastUp', () => page.evaluate(() => __lp.scan({ step: -120, fast: true })));
		result.passes.fastDown = summarize(down);
		result.passes.fastUp = summarize(up);
	}
	if (passes.includes('jump')) {
		// One scrollTop write that puts a point of the picture (frac of its height) at the top of the
		// window, then 10 slow steps up and 20 down. CodeMirror keeps ~500px drawn above a jump target,
		// so only pictures taller than that can lose their line this way.
		const jumpAndScroll = (imgFrom, frac, start) =>
			page.evaluate(
				async ({ imgFrom, frac, start }) => {
					const v = __lp.view();
					if (start !== 'here') {
						v.scrollDOM.scrollTop = start === 'top' ? 0 : v.scrollDOM.scrollHeight;
						await __lp.settle(300);
					}
					const k = __lp.cal.get(imgFrom);
					__lp.jumpTo(v.lineBlockAt(k.lineFrom).top + k.layoutTop + k.h * frac);
					await __lp.frames(2);
					await __lp.sleep(30);
					const atJump = __lp.imageStatus().filter((i) => i.from === k.from);
					await __lp.settle(500);
					const settled = __lp.imageStatus().filter((i) => i.from === k.from);
					const steps = [];
					for (const dir of [-1, 1, 1]) {
						for (let i = 0; i < 10; i++) {
							const before = __lp.snapshot();
							const s0 = v.scrollDOM.scrollTop;
							v.scrollDOM.scrollTop = s0 + dir * 40;
							await __lp.frames(2);
							await __lp.sleep(30);
							steps.push(__lp.measureStep(before, { at: Math.round(s0), dir }));
						}
					}
					return { atJump, settled, steps };
				},
				{ imgFrom, frac, start },
			);
		const record = (img, start, frac, r) => {
			const s = summarize(r.steps);
			return {
				image: label(img),
				from: start,
				frac,
				atJump: r.atJump,
				settled: r.settled,
				after: { jumps: s.jumps, maxJump: s.maxJump, lostWrapSteps: s.stepsWithLostWrap, jumpList: s.jumpList },
			};
		};
		const jumps = [];
		phase = 'jump';
		for (const img of calibration) {
			for (const start of ['top', 'bottom']) {
				for (const frac of [0.5, 0.75, 0.9]) jumps.push(record(img, start, frac, await jumpAndScroll(img.from, frac, start)));
			}
		}
		result.passes.jump = jumps;
		// Freshly opened, straight to the bottom part of a tall picture: its line has never been drawn
		// in this editor, so the stand-in's size is estimated from the picture and the link.
		const fresh = [];
		phase = 'jumpFresh';
		for (const img of calibration.filter((c) => c.h > 400)) {
			await reopen();
			fresh.push(record(img, 'fresh', 0.92, await jumpAndScroll(img.from, 0.92, 'here')));
		}
		result.passes.jumpFresh = fresh;
		// Through CodeMirror's own scrollIntoView, as jump-to-line does, to a line beside the picture's bottom.
		// The target line must end up at the window's top (within a few px, as with the plugin off): the
		// stand-in that follows the jump re-wraps the text above it (src/live-preview/stand-ins.ts, noteScroll).
		const viaEffect = [];
		phase = 'jumpViaScrollIntoView';
		for (const img of calibration) {
			phase = `jumpViaScrollIntoView L${img.n}`;
			const r = await page.evaluate(async (imgFrom) => {
				const v = __lp.view();
				const c = __lp.cal.get(imgFrom);
				v.scrollDOM.scrollTop = 0;
				await __lp.settle(300);
				const target = v.lineBlockAtHeight(v.lineBlockAt(c.lineFrom).top + c.layoutTop + c.h * 0.9);
				const targetTop = () => {
					const el = __lp.lineEl(v, target.from);
					return el ? Math.round(el.getBoundingClientRect().top - v.scrollDOM.getBoundingClientRect().top) : null;
				};
				v.dispatch({ effects: v.constructor.scrollIntoView(target.from, { y: 'start' }) });
				await __lp.frames(2);
				await __lp.sleep(30);
				const atJump = __lp.imageStatus().filter((i) => i.from === c.from);
				await __lp.settle(500);
				const settled = __lp.imageStatus().filter((i) => i.from === c.from);
				return { atJump, settled, target: v.state.doc.lineAt(target.from).number, targetTop: targetTop() };
			}, img.from);
			viaEffect.push({ image: label(img), from: 'scrollIntoView', frac: 0.9, ...r });
		}
		result.passes.jumpViaScrollIntoView = viaEffect;
	}

	if (disabled) await page.evaluate(() => window.app.plugins.enablePluginAndSave('image-text-wrap'));
	result.errors = errors;
	result.measureLoopWarnings = warnings.length;
	result.warnings = warnings;
	if (outFile) writeFileSync(outFile, JSON.stringify(result, null, 2));

	// Short summary on stdout.
	const lines = [`${note}, plugin ${disabled ? 'disabled' : 'enabled'}`];
	lines.push(`images: ${calibration.map((c) => `${label(c)} ${c.side} ${Math.round(c.w)}x${Math.round(c.h)} float:${c.float}`).join('; ')}`);
	for (const [name, p] of Object.entries(result.passes)) {
		if (Array.isArray(p)) {
			for (const j of p) {
				const at = (j.atJump ?? []).map((i) => `${i.drawn ? 'drawn' : i.standIn ? 'stand-in' : 'UNDRAWN'} lost:${i.intrudeVisible}`).join(',') || 'not reaching';
				const settled = (j.settled ?? []).map((i) => `${i.drawn ? 'drawn' : i.standIn ? 'stand-in' : 'UNDRAWN'} lost:${i.intrudeVisible}`).join(',');
				const after = j.after ? ` | then 30 steps: jumps ${j.after.jumps} max ${j.after.maxJump}px, lost-wrap steps ${j.after.lostWrapSteps}` : '';
				const target = j.target ? ` | target L${j.target} at ${j.targetTop}px from the top` : '';
				lines.push(`${name} ${j.image} ${j.from} ${j.frac}: at jump ${at}; settled ${settled}${after}${target}`);
			}
		} else {
			lines.push(
				`${name}: steps ${p.steps}, jumps ${p.jumps} (max ${p.maxJump}px) [${p.jumpList.map((j) => `${j.at}:${j.px}/${j.dh}`).join(' ')}], ` +
					`image line undrawn but reaching ${p.stepsWithUndrawnImageReaching} (stand-in shown ${p.stepsWithStandIn}), ` +
					`lost wrap in window ${p.stepsWithLostWrap}, above window only ${p.stepsWithLostWrapAboveWindow}, max drift ${p.maxDrift}px, ` +
					`transactions ${p.dispatches}`,
			);
		}
	}
	const byPhase = {};
	for (const w of warnings) byPhase[`${w.phase}: ${w.text}`] = (byPhase[`${w.phase}: ${w.text}`] ?? 0) + 1;
	lines.push(`console errors ${errors.length}, measure-loop warnings ${warnings.length} ${JSON.stringify(byPhase)}`);
	return lines.join('\n');
};
