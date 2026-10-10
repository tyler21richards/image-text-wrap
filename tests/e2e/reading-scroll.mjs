// Brief 7 item 9 / M1: does Reading view jump while scrolling a note with wrapped images?
//
// Method from Adjustable Media (docs/SCROLL_VALIDATION.md and DESIGN.md 4.1), MIT: scroll the Reading
// view in 40 px steps, and after each step compare where still-attached section elements are with where
// the scroll alone should have put them; any difference over 2 px is a jump. Passes:
//   warm  top -> bottom -> top, after the note has been opened and scrolled once
//   cold  fresh open, jump to the end, wait for Obsidian's background measuring, then back to the top
// each with the plugin on and with it off (the control: Obsidian's own reflow, e.g. math, images).
//
//   node scripts/obsidian.mjs run tests/e2e/reading-scroll.mjs [note] [step]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Runs in the page. Scans the active Reading view; returns the jumps found. */
async function scan({ step, dirs, waitMs }) {
	const view = app.workspace.activeLeaf.view;
	const scroller = view.previewMode.containerEl.querySelector('.markdown-preview-view');
	const sizer = scroller.querySelector('.markdown-preview-sizer');
	const frames = (n) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
	const label = (el) => {
		const i = [...sizer.children].indexOf(el);
		return `${i}:${el.className.replace('itw-wrap-note', '').trim()}:${el.textContent.trim().slice(0, 20)}`;
	};
	const anchors = () => {
		const s = scroller.getBoundingClientRect();
		return [...sizer.children].filter((el) => {
			if (el.classList.contains('markdown-preview-pusher')) return false;
			const r = el.getBoundingClientRect();
			return r.height > 0 && r.top > s.top + 40 && r.bottom < s.bottom - 40;
		}).slice(0, 8);
	};
	// A wrapped image whose section Obsidian has taken off the page while text it wraps is still on the
	// page: that text loses its wrap. Section tops off the page come from the renderer's measured heights.
	const renderer = view.previewMode.renderer;
	const floatReach = new Map(); // section index -> how far its float reaches below the section top
	const isFloat = (f) => ['left', 'right'].includes(getComputedStyle(f).float);
	const lostWraps = () => {
		const secs = renderer.sections;
		secs.forEach((s, i) => {
			if (!s.el.isConnected) return;
			const top = s.el.getBoundingClientRect().top;
			for (const f of s.el.querySelectorAll('.image-embed, p > img')) {
				if (isFloat(f)) floatReach.set(i, Math.max(floatReach.get(i) ?? 0, f.getBoundingClientRect().bottom - top));
			}
		});
		const first = secs.findIndex((s) => s.el.isConnected && !s.el.classList.contains('mod-ui'));
		if (first < 0) return [];
		const firstTop = secs[first].el.getBoundingClientRect().top;
		const lost = [];
		for (const [i, reach] of floatReach) {
			if (secs[i].el.isConnected || i >= first) continue;
			let top = firstTop;
			for (let k = i; k < first; k++) top -= secs[k].shown === false ? 0 : secs[k].height;
			if (top + reach > firstTop + 1) lost.push({ section: i, reach: Math.round(reach), hiddenPart: Math.round(top + reach - firstTop) });
		}
		return lost;
	};
	const jumps = [];
	const lost = [];
	let steps = 0;
	for (const dir of dirs) {
		for (let i = 0; i < 5000; i++) {
			const before = anchors().map((el) => [el, el.getBoundingClientRect().top]);
			const start = scroller.scrollTop;
			scroller.scrollTop = start + dir * step;
			await frames(2);
			await new Promise((r) => setTimeout(r, waitMs));
			const moved = scroller.scrollTop - start;
			if (moved === 0) break;
			steps++;
			let worst = 0;
			let who = null;
			for (const [el, top] of before) {
				if (!el.isConnected) continue;
				const err = el.getBoundingClientRect().top - (top - moved);
				if (Math.abs(err) > Math.abs(worst)) {
					worst = err;
					who = el;
				}
			}
			if (Math.abs(worst) > 2) jumps.push({ dir, at: Math.round(start), px: Math.round(worst * 10) / 10, anchor: label(who) });
			const l = lostWraps();
			if (l.length) {
				// The plugin's stand-ins (src/reading/stand-ins.ts) keep the wrap when one is showing.
				const covered = [...sizer.querySelectorAll('.itw-stand-in')].some((s) => getComputedStyle(s).display !== 'none');
				lost.push({ dir, at: Math.round(start), covered, lost: l });
			}
		}
	}
	const uncovered = lost.filter((l) => !l.covered);
	return {
		steps,
		jumps,
		anchorGoneSteps: lost.length,
		lostWrapSteps: uncovered.length,
		lost: uncovered.slice(0, 10),
		scrollHeight: scroller.scrollHeight,
	};
}

async function openFresh(page, path) {
	await page.evaluate(async (path) => {
		const leaves = app.workspace.getLeavesOfType('markdown');
		leaves.slice(1).forEach((l) => l.detach());
		// A new leaf: nothing measured or cached yet.
		const old = app.workspace.getLeavesOfType('markdown')[0];
		const leaf = app.workspace.getLeaf('tab');
		await leaf.openFile(app.vault.getAbstractFileByPath(path), { state: { mode: 'preview' }, active: true });
		old?.detach();
	}, path);
	await sleep(600);
}

async function passes(page, path, step) {
	const out = {};
	// Cold: fresh open, jump to the end, let Obsidian measure in the background, then scan to the top.
	await openFresh(page, path);
	await page.evaluate(() => {
		const s = app.workspace.activeLeaf.view.previewMode.containerEl.querySelector('.markdown-preview-view');
		s.scrollTop = s.scrollHeight;
	});
	await sleep(2500);
	out.cold = await page.evaluate(scan, { step, dirs: [-1], waitMs: 30 });
	// Warm: everything measured once; top -> bottom -> top.
	out.warm = await page.evaluate(scan, { step, dirs: [1, -1], waitMs: 30 });
	// First pass of a fresh open, top -> bottom, without waiting at the end first.
	await openFresh(page, path);
	out.firstDown = await page.evaluate(scan, { step, dirs: [1], waitMs: 30 });
	return out;
}

export default async ({ page, args, setWindowSize, watchErrors, reloadPlugin, cfg }) => {
	const path = args[0] ?? 'Fixture.md';
	const step = Number(args[1] ?? 40);
	const errors = watchErrors(page);
	await setWindowSize(page, 1280, 900);
	const result = { note: path, step };
	result.pluginOn = await passes(page, path, step);
	await page.evaluate(() => app.plugins.disablePlugin('image-text-wrap'));
	await sleep(300);
	// Quick disable/enable cycles of the harness can leave an extra copy of styles.css in the page
	// (seen once on 1.14.4); the control must run without any of our CSS.
	result.staleStyleCopiesRemoved = await page.evaluate(() => {
		let n = 0;
		for (const sheet of [...document.styleSheets]) {
			try {
				if ([...sheet.cssRules].some((r) => r.cssText.includes('.itw-'))) {
					sheet.ownerNode?.remove();
					n++;
				}
			} catch {
				/* cross-origin sheet */
			}
		}
		return n;
	});
	try {
		result.pluginOff = await passes(page, path, step);
	} finally {
		await reloadPlugin(page, cfg);
	}
	result.errors = errors;
	return result;
};
