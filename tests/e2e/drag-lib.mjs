// Helpers for the drag-to-move probes (tests/e2e/drag-acceptance.mjs). Everything that touches the
// note goes through real, trusted input (page.mouse / page.keyboard); page.evaluate only measures.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURE = 'Fixture.md';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
export const fixtureText = () => readFileSync(join(ROOT, 'test-vault', FIXTURE), 'utf8');

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Waits two animation frames in the page, so a coalesced placement has run. */
export const frames = (page, n = 2) =>
	page.evaluate(
		(n) =>
			new Promise((resolve) => {
				let left = n;
				const tick = () => (--left <= 0 ? resolve() : requestAnimationFrame(tick));
				requestAnimationFrame(tick);
			}),
		n,
	);

/** Scrolls the active editor so that document line `line` (0-based) sits `offset` px below the scroller top. */
export async function scrollToLine(page, line, offset = 80) {
	await page.evaluate(
		({ line, offset }) => {
			const cm = app.workspace.activeLeaf.view.editor.cm;
			const block = cm.lineBlockAt(cm.state.doc.line(line + 1).from);
			cm.scrollDOM.scrollTop = Math.max(0, block.top - offset);
		},
		{ line, offset },
	);
	await sleep(250);
	await frames(page, 3);
}

/** Geometry of the editor, the note column, and (optionally) the image whose link starts on `line`. */
export async function geometry(page, line = null) {
	return page.evaluate((line) => {
		const cm = app.workspace.activeLeaf.view.editor.cm;
		const r = (el) => {
			const b = el.getBoundingClientRect();
			return { left: b.left, top: b.top, right: b.right, bottom: b.bottom, width: b.width, height: b.height };
		};
		let img = null;
		if (line !== null) {
			const from = cm.state.doc.line(line + 1).from;
			for (const el of cm.contentDOM.querySelectorAll('.internal-embed.image-embed')) {
				let pos = -1;
				try {
					pos = cm.posAtDOM(el);
				} catch {}
				if (pos >= from && pos <= cm.state.doc.line(line + 1).to) {
					img = r(el.querySelector('img'));
					break;
				}
			}
		}
		return { scroller: r(cm.scrollDOM), column: r(cm.contentDOM), img, scrollTop: cm.scrollDOM.scrollTop };
	}, line);
}

/** Client y of the top of document line `line` (0-based); the line count gives the bottom of the note. */
export async function lineY(page, line) {
	return page.evaluate((line) => {
		const cm = app.workspace.activeLeaf.view.editor.cm;
		const doc = cm.state.doc;
		const top = line < doc.lines ? cm.lineBlockAt(doc.line(line + 1).from).top : cm.lineBlockAt(doc.length).bottom;
		return top + cm.documentTop;
	}, line);
}

/** Client y of the middle of the block that holds document line `line` (a table or callout is one block). */
export async function blockMiddleY(page, line) {
	return page.evaluate((line) => {
		const cm = app.workspace.activeLeaf.view.editor.cm;
		const b = cm.lineBlockAt(cm.state.doc.line(line + 1).from);
		return b.top + b.height / 2 + cm.documentTop;
	}, line);
}

/** What the drag shows right now. */
export async function dragState(page) {
	return page.evaluate(() => {
		const vis = (sel) => {
			const el = document.querySelector(sel);
			if (!el || el.classList.contains('is-hidden')) return null;
			const b = el.getBoundingClientRect();
			return { left: Math.round(b.left), top: Math.round(b.top), width: Math.round(b.width), height: Math.round(b.height), text: el.textContent };
		};
		return {
			bodyClasses: [...document.body.classList].filter((c) => /itw|grabbing|dragging/.test(c)),
			cursor: getComputedStyle(document.body).cursor,
			ghost: vis('.itw-drag-ghost'),
			bar: vis('.itw-drop-bar'),
			box: vis('.itw-drop-box'),
			label: vis('.itw-drop-label'),
			dimmed: document.querySelectorAll('.itw-drag-source').length,
			overlays: document.querySelectorAll('.itw-drag-ghost, .itw-drop-bar, .itw-drop-box, .itw-drop-label').length,
		};
	});
}

/** Presses at `from`, moves to `to` in `steps`, and leaves the button down. */
export async function pressAndMove(page, from, to, steps = 12) {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(from.x + 2, from.y + 2, { steps: 2 });
	await page.mouse.move(to.x, to.y, { steps });
	await frames(page, 2);
}

/** A whole drag: press, move, release. */
export async function drag(page, from, to, steps = 12) {
	await pressAndMove(page, from, to, steps);
	const during = await dragState(page);
	await page.mouse.up();
	await sleep(150);
	await frames(page, 2);
	return during;
}

export async function noteText(page) {
	return page.evaluate(() => app.workspace.activeLeaf.view.editor.cm.state.doc.toString());
}

/**
 * Resets the fixture note in the open editor and waits for it to render. Done through the editor and
 * then saved: writing the file while the editor holds unsaved changes makes Obsidian merge the two.
 */
export async function resetNote(page, _setNote, text = fixtureText()) {
	await page.evaluate(async (text) => {
		const view = app.workspace.activeLeaf.view;
		if (view.editor.getValue() !== text) view.editor.setValue(text);
		await view.save();
		view.editor.cm.focus();
	}, text);
	await sleep(300);
	await frames(page, 3);
}

/**
 * Closes Obsidian's image viewer (or a modal) if an earlier probe left it open: it covers the whole window,
 * so the first press would land on it. The viewer does not always have the keyboard, so its close button
 * (or its background) is clicked, as a user would.
 */
export async function closeViewer(page) {
	for (let i = 0; i < 3; i++) {
		const target = await page.evaluate(() => {
			const box = document.querySelector('.lightbox');
			if (!box) return document.querySelector('.modal-container') ? 'escape' : null;
			const close = [...box.querySelectorAll('.lightbox-titlebar .clickable-icon, .lightbox-titlebar button')].pop();
			const r = (close ?? box.querySelector('.lightbox-bg') ?? box).getBoundingClientRect();
			return close ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : { x: r.left + 10, y: r.bottom - 10 };
		});
		if (!target) return;
		if (target === 'escape') await page.keyboard.press('Escape');
		else await page.mouse.click(target.x, target.y);
		await sleep(350);
	}
}

/**
 * Writes `text` to the note at `path`, opens it in Live Preview, puts the cursor on its first line and
 * scrolls to the top. For probes that need a note of their own.
 */
export async function openText(page, h, path, text) {
	await page.keyboard.press('Escape').catch(() => {});
	await h.setNote(page, path, text);
	await h.openNote(page, path, 'live');
	await resetNote(page, null, text);
	await page.evaluate(() => {
		const cm = app.workspace.activeLeaf.view.editor.cm;
		cm.dispatch({ selection: { anchor: 0 } });
		cm.scrollDOM.scrollTop = 0;
	});
	await sleep(300);
	await frames(page, 3);
}

/** Index of the first line starting with `prefix`, or -1. */
export async function lineStarting(page, prefix) {
	return page.evaluate((prefix) => {
		const doc = app.workspace.activeLeaf.view.editor.cm.state.doc;
		for (let i = 1; i <= doc.lines; i++) if (doc.line(i).text.startsWith(prefix)) return i - 1;
		return -1;
	}, prefix);
}

/**
 * The real image embed whose link starts with `prefix`, wherever it is now: its line, its box and its
 * picture's box (client px), or null when it is not drawn.
 */
export async function embedOf(page, prefix) {
	return page.evaluate((prefix) => {
		const cm = app.workspace.activeLeaf.view.editor.cm;
		const doc = cm.state.doc;
		for (const el of cm.contentDOM.querySelectorAll('.internal-embed.image-embed')) {
			let pos = -1;
			try {
				pos = cm.posAtDOM(el);
			} catch {
				continue;
			}
			const line = doc.lineAt(pos);
			if (!doc.sliceString(pos, line.to).startsWith(prefix)) continue;
			const r = (e) => {
				const b = e.getBoundingClientRect();
				return { top: Math.round(b.top * 10) / 10, bottom: Math.round(b.bottom * 10) / 10, left: Math.round(b.left), right: Math.round(b.right) };
			};
			const img = el.querySelector('img');
			return { line: line.number - 1, float: getComputedStyle(el).float, box: r(el), img: img ? r(img) : null };
		}
		return null;
	}, prefix);
}

/**
 * Where the drop indicator was asked to be drawn (its CSS variables, client px): the bar and the outline
 * box tops, or null for a part that is hidden.
 */
export async function indicatorTops(page) {
	return page.evaluate(() => {
		const y = (sel) => {
			const el = document.querySelector(sel);
			if (!el || el.classList.contains('is-hidden')) return null;
			return Math.round(parseFloat(el.style.getPropertyValue('--itw-drop-y')) * 10) / 10;
		};
		return { bar: y('.itw-drop-bar'), box: y('.itw-drop-box'), label: document.querySelector('.itw-drop-label:not(.is-hidden)')?.textContent ?? null };
	});
}

/** Client tops of the first lines starting with each prefix (null when there is none). */
export async function lineTops(page, prefixes) {
	return page.evaluate((prefixes) => {
		const cm = app.workspace.activeLeaf.view.editor.cm;
		const doc = cm.state.doc;
		const out = {};
		for (const p of prefixes) {
			out[p] = null;
			for (let i = 1; i <= doc.lines; i++) {
				if (!doc.line(i).text.startsWith(p)) continue;
				out[p] = Math.round((cm.lineBlockAt(doc.line(i).from).top + cm.documentTop) * 10) / 10;
				break;
			}
		}
		return out;
	}, prefixes);
}

export const scrollTop = (page) => page.evaluate(() => Math.round(app.workspace.activeLeaf.view.editor.cm.scrollDOM.scrollTop));

/** The stand-in copies drawn now (stand-ins.ts): their link positions and boxes. */
export async function standIns(page) {
	return page.evaluate(() =>
		[...app.workspace.activeLeaf.view.editor.cm.contentDOM.querySelectorAll('.itw-stand-in-float')].map((el) => {
			const b = el.getBoundingClientRect();
			return { from: Number(el.dataset.from), top: Math.round(b.top), bottom: Math.round(b.bottom) };
		}),
	);
}

/** Lines of `text` that differ from `before`, as [index, before, after] (a quick diff for reports). */
export function changedLines(before, after) {
	const a = before.split('\n');
	const b = after.split('\n');
	const out = [];
	for (let i = 0; i < Math.max(a.length, b.length); i++) if (a[i] !== b[i]) out.push([i, a[i], b[i]]);
	return out;
}
