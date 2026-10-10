// Helpers for the picture toolbar probes (tests/e2e/toolbar-*.mjs). Run a probe with:
//   node scripts/obsidian.mjs run tests/e2e/toolbar-basic.mjs
// Every click and key press goes through page.mouse / page.keyboard (trusted CDP input).
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Wraps a probe body `(h, check) => …` so it returns [{ test, result, evidence }], including the checks
 * made before a failure and the failure itself.
 */
export function probe(body) {
	return async (h) => {
		const results = [];
		const check = (test, ok, evidence) => results.push({ test, result: ok ? 'pass' : 'fail', evidence });
		try {
			await body(h, check);
		} catch (e) {
			const shot = join(process.env.ITW_STATE_DIR ?? ROOT, `probe-error-${process.env.ITW_INSTANCE ?? 0}.png`);
			await h.page.screenshot({ path: shot }).catch(() => {});
			results.push({ test: 'probe ran to the end', result: 'fail', evidence: `${String(e?.stack ?? e)} (screenshot: ${shot})` });
		}
		return results;
	};
}

/** The note's text as committed in test-vault. */
export function sourceNote(path) {
	return readFileSync(join(ROOT, 'test-vault', path), 'utf8');
}

/**
 * Closes Obsidian's image viewer if a step left it open (it covers the whole window). Esc only reaches it
 * when it has focus, so click its close button or its backdrop.
 */
export async function closeLightbox(page) {
	for (let i = 0; i < 3; i++) {
		const target = await page.evaluate(() => {
			const box = document.querySelector('.lightbox');
			if (!box) return null;
			const close = [...box.querySelectorAll('.lightbox-titlebar .clickable-icon, .lightbox-titlebar button')].pop();
			const r = (close ?? box.querySelector('.lightbox-bg') ?? box).getBoundingClientRect();
			return close ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: r.left + 10, y: r.bottom - 10 };
		});
		if (!target) return;
		await page.mouse.click(target.x, target.y);
		await sleep(350);
	}
}

/**
 * Restores a note from test-vault, opens it in Live Preview, and puts the cursor at the start so no image
 * is left selected from an earlier run (a click on a selected image opens Obsidian's viewer instead).
 */
export async function freshNote(page, h, path, mode = 'live') {
	await closeLightbox(page);
	await h.setNote(page, path, sourceNote(path));
	await h.openNote(page, path, mode);
	if (mode !== 'reading') {
		await page.evaluate(() => {
			app.workspace.activeLeaf.view.editor.cm.scrollDOM.scrollTop = 0;
		});
		await sleep(300);
		// A real click: Obsidian only lets go of a selected image when the user moves the cursor.
		if (mode === 'live') await clickText(page);
	}
	await sleep(300);
}

/** Lists the lines that differ between two texts: [{ line, before, after }]. */
export function diffLines(before, after) {
	const a = before.split('\n');
	const b = after.split('\n');
	const out = [];
	for (let i = 0; i < Math.max(a.length, b.length); i++) {
		if (a[i] !== b[i]) out.push({ line: i + 1, before: a[i], after: b[i] });
	}
	return out;
}

/**
 * Scrolls the image link that starts at the `nth` (0-based) occurrence of `needle` in the active note
 * into view (centred unless `y` is given) and returns its picture's rectangle and link position.
 */
export async function showImage(page, needle, nth = 0, y = 'center') {
	await page.evaluate(
		({ needle, nth, y }) => {
			const cm = app.workspace.activeLeaf.view.editor.cm;
			const text = cm.state.doc.toString();
			let pos = -1;
			for (let i = 0; i <= nth; i++) pos = text.indexOf(needle, pos + 1);
			if (pos < 0) throw new Error(`not found: ${needle}`);
			cm.dispatch({ effects: cm.constructor.scrollIntoView(pos, { y, yMargin: 120 }) });
		},
		{ needle, nth, y },
	);
	await sleep(400);
	return imageRect(page, needle, nth);
}

/** The rectangle of the picture whose link is the nth occurrence of `needle`, without scrolling. */
export async function imageRect(page, needle, nth = 0) {
	return page.evaluate(
		({ needle, nth }) => {
			const cm = app.workspace.activeLeaf.view.editor.cm;
			const text = cm.state.doc.toString();
			let pos = -1;
			for (let i = 0; i <= nth; i++) pos = text.indexOf(needle, pos + 1);
			const embed = [...cm.contentDOM.querySelectorAll('.image-embed')].find((e) => {
				try {
					return cm.posAtDOM(e) === pos;
				} catch {
					return false;
				}
			});
			if (!embed) return { pos, found: false };
			const r = (embed.querySelector('img') ?? embed).getBoundingClientRect();
			return { pos, found: true, left: r.left, top: r.top, right: r.right, bottom: r.bottom, x: r.left + r.width / 2, y: r.top + r.height / 2 };
		},
		{ needle, nth },
	);
}

/** Everything a probe checks about the toolbar, the selected image and the editor, in one read. */
export async function state(page) {
	return page.evaluate(() => {
		const rect = (el) => {
			const r = el.getBoundingClientRect();
			return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom) };
		};
		const view = app.workspace.activeLeaf.view;
		const cm = view.editor?.cm;
		const toolbars = [...document.querySelectorAll('.itw-toolbar')];
		const tb = toolbars.find((t) => !t.classList.contains('itw-toolbar-hidden'));
		const sel = cm?.contentDOM.querySelector('.image-embed.is-selected');
		let selPos = null;
		try {
			selPos = sel ? cm.posAtDOM(sel) : null;
		} catch {
			/* detached */
		}
		return {
			toolbarCount: toolbars.length,
			visible: !!tb,
			placement: tb?.dataset.placement ?? null,
			toolbar: tb ? rect(tb) : null,
			buttons: tb
				? [...tb.querySelectorAll('button')].map((b) => ({
						label: b.getAttribute('aria-label'),
						pressed: b.getAttribute('aria-pressed'),
						active: b.classList.contains('is-active'),
						disabled: b.getAttribute('aria-disabled') === 'true',
						rect: rect(b),
					}))
				: [],
			selected: !!sel,
			selPos,
			native: sel ? [...sel.querySelectorAll('.image-resize-corner, .embed-actions, .edit-block-button')].map((e) => ({ cls: e.className, ...rect(e) })) : [],
			picture: sel ? rect(sel.querySelector('img') ?? sel) : null,
			column: cm ? rect(cm.contentDOM) : null,
			scroller: cm ? rect(cm.scrollDOM) : null,
			scrollTop: cm ? cm.scrollDOM.scrollTop : null,
			hasFocus: cm ? cm.hasFocus : null,
			doc: cm ? cm.state.doc.toString() : null,
			menu: [...document.querySelectorAll('.menu .menu-item')].map((m) => ({
				title: m.querySelector('.menu-item-title')?.textContent,
				checked: m.classList.contains('mod-checked') || !!m.querySelector('.mod-checked, .menu-item-icon.mod-checked'),
				section: m.dataset.section ?? null,
				disabled: m.classList.contains('is-disabled'),
			})),
		};
	});
}

export function overlaps(a, b) {
	return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** Checks a visible toolbar against the native controls, the note column and the visible scroller. */
export function geometryProblems(s) {
	const problems = [];
	if (!s.toolbar) return ['no toolbar'];
	for (const n of s.native) if (overlaps(s.toolbar, n)) problems.push(`covers ${n.cls}`);
	if (s.toolbar.left < s.column.left - 1 || s.toolbar.right > s.column.right + 1) problems.push('outside the note column');
	if (s.toolbar.top < s.scroller.top || s.toolbar.bottom > s.scroller.bottom) problems.push('outside the visible scroller');
	if (s.placement !== 'inside' && overlaps(s.toolbar, s.picture)) problems.push('covers the picture');
	return problems;
}

/** Clicks a toolbar button by its label, with a real mouse click at its centre. */
export async function clickButton(page, label) {
	const s = await state(page);
	const b = s.buttons.find((x) => x.label === label || x.label?.startsWith(label));
	if (!b) throw new Error(`no toolbar button "${label}" (have ${s.buttons.map((x) => x.label).join(', ')})`);
	await page.mouse.click((b.rect.left + b.rect.right) / 2, (b.rect.top + b.rect.bottom) / 2);
	await sleep(350);
}

/** Clicks a menu item by its title. */
export async function clickMenuItem(page, title) {
	const r = await page.evaluate((title) => {
		const item = [...document.querySelectorAll('.menu .menu-item')].find((m) => m.querySelector('.menu-item-title')?.textContent === title);
		if (!item) return null;
		const b = item.getBoundingClientRect();
		return { x: b.left + b.width / 2, y: b.top + b.height / 2 };
	}, title);
	if (!r) throw new Error(`no menu item "${title}"`);
	await page.mouse.click(r.x, r.y);
	await sleep(350);
}

export function pressed(s) {
	return s.buttons.filter((b) => b.pressed === 'true').map((b) => b.label);
}

/** Clicks plain text in the note (deselects any image). */
export async function clickText(page) {
	const p = await page.evaluate(() => {
		const cm = app.workspace.activeLeaf.view.editor.cm;
		const sr = cm.scrollDOM.getBoundingClientRect();
		const lines = [...cm.contentDOM.querySelectorAll('.cm-line')].filter((l) => {
			const r = l.getBoundingClientRect();
			return !l.querySelector('.image-embed, .cm-embed-block') && l.textContent.length > 40 && r.top > sr.top + 60 && r.bottom < sr.bottom - 40;
		});
		const toolbar = [...document.querySelectorAll('.itw-toolbar')].find((t) => !t.classList.contains('itw-toolbar-hidden'));
		const tr = toolbar?.getBoundingClientRect();
		for (const l of lines) {
			const r = l.getBoundingClientRect();
			for (const x of [r.left + 30, (r.left + r.right) / 2, r.right - 30]) {
				const y = r.top + 10;
				if (tr && x > tr.left - 4 && x < tr.right + 4 && y > tr.top - 4 && y < tr.bottom + 4) continue;
				const hit = document.elementFromPoint(x, y);
				if (hit && hit.closest('.cm-line') === l && !hit.closest('.image-embed')) return { x, y };
			}
		}
		throw new Error('no plain text on screen to click');
	});
	await page.mouse.click(p.x, p.y);
	await sleep(300);
}
