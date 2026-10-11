// M5: long-press to drag on phones and tablets, in a real Obsidian switched to its own mobile emulation, with
// real touch input sent through the DevTools protocol (tests/e2e/mobile.mjs).
//
//   node scripts/obsidian.mjs run tests/e2e/mobile-drag.mjs <screenshot dir> [phone|tablet|light|dark|<part of a test name> ...]
//
// Every test runs in phone and in tablet emulation, in the light and in the dark theme; the emulation is
// switched off again at the end. Gestures are real touch input (touch(page)) and real key presses.
// page.evaluate measures, resets the note, flips the setting, records buzzes, and stands in for the on-screen
// keyboard (window.visualViewport), which the emulation does not have.
// Prints one line per test: size, theme, name, pass/fail, and the evidence.
import { mkdirSync } from 'node:fs';
import * as d from './drag-lib.mjs';
import { setMobile, touch } from './mobile.mjs';

const L = {
	landscape: 4, // ![[landscape.png|wrap-left|300]]
	heading: 45, // ## The same image twice
	squareWrapped: 47, // ![[square.png|wrap-left|180]]
	squarePlain: 50, // ![[square.png|180]]
	topHeading: 53, // ## Top and bottom
};
/** How long a finger rests before it moves: past the 500 ms long press. */
const HOLD = 700;
/** Past Obsidian's own long press on iPhone and iPad (0.8 s), which sends a contextmenu of its own. */
const LONG_HOLD = 1200;
const THEMES = [
	['moonstone', 'light'],
	['obsidian', 'dark'],
];

export default async ({ page, openNote, watchErrors, args }) => {
	const out = args[0] ?? '.';
	const picks = args.slice(1);
	const pick = (all) => (all.some((x) => picks.includes(x)) ? all.filter((x) => picks.includes(x)) : all);
	const sizes = pick(['phone', 'tablet']);
	const themes = THEMES.filter(([, name]) => pick(['light', 'dark']).includes(name));
	const only = picks.filter((x) => !['phone', 'tablet', 'light', 'dark'].includes(x));
	mkdirSync(out, { recursive: true });
	const errors = watchErrors(page);
	const original = d.fixtureText();
	const results = [];
	const tp = touch(page);
	const themeBefore = await page.evaluate(() => app.vault.getConfig('theme'));

	/** Buzzes, pick-up rings, menus, pointercancels and touchmoves seen since the last take(). */
	const instrument = () =>
		page.evaluate(() => {
			if (window.__itwM5) return;
			const rec = (window.__itwM5 = { buzz: [], rings: 0, menus: 0, cancels: 0, moves: [], ends: [] });
			// Whatever can end a press besides lifting the finger, for the evidence.
			const end = (e) => rec.ends.push(`${Math.round(e.timeStamp)} ${e.type}${e.target?.className ? ` on ${String(e.target.className).split(' ')[0]}` : ''}${e.type === 'touchmove' ? ` c=${e.cancelable}` : ''}`);
			for (const type of ['pointercancel', 'lostpointercapture', 'touchcancel', 'touchmove', 'touchend']) window.addEventListener(type, end, true);
			window.addEventListener('blur', end);
			// The element a finger lands on, which gets the touch events for as long as the finger is down.
			window.addEventListener('pointerdown', (e) => (rec.pressed = e.target), true);
			document.addEventListener('visibilitychange', end);
			navigator.vibrate = (ms) => (rec.buzz.push(ms), true);
			new MutationObserver((records) => {
				for (const r of records)
					for (const n of r.addedNodes) {
						if (n.classList?.contains('itw-pick-up')) rec.rings++;
						if (n.classList?.contains('menu')) rec.menus++;
					}
			}).observe(document.body, { childList: true });
			window.addEventListener('pointercancel', () => rec.cancels++, true);
			window.addEventListener('touchmove', (e) => rec.moves.push(e), { capture: true, passive: true });
		});
	const take = () =>
		page.evaluate(() => {
			const r = window.__itwM5;
			const res = {
				buzz: r.buzz.splice(0),
				rings: r.rings,
				menus: r.menus,
				cancels: r.cancels,
				moves: r.moves.length,
				prevented: r.moves.filter((e) => e.defaultPrevented).length,
				ends: r.ends.splice(0),
			};
			r.rings = r.menus = r.cancels = 0;
			r.moves = [];
			return res;
		});
	const snap = () =>
		page.evaluate(() => {
			const cm = app.workspace.activeLeaf.view.editor.cm;
			const lineOf = (el) => {
				try {
					return cm.state.doc.lineAt(cm.posAtDOM(el)).number - 1;
				} catch {
					return -1;
				}
			};
			return {
				scrollTop: Math.round(cm.scrollDOM.scrollTop),
				selected: [...cm.contentDOM.querySelectorAll('.image-embed.is-selected')].map(lineOf),
				lifted: [...cm.contentDOM.querySelectorAll('.itw-drag-lifted')].map(lineOf),
				pressed: cm.contentDOM.querySelectorAll('.itw-drag-pressed').length,
				textSelected: String(document.getSelection()),
				cursor: [cm.state.selection.main.from, cm.state.selection.main.to],
				focused: cm.hasFocus,
				viewer: !!document.querySelector('.lightbox'),
				menu: !!document.querySelector('.menu'),
			};
		});
	/**
	 * The part of the note that can be seen, measured here independently of the plugin: the scroller, less the
	 * view header and the navigation bar or editing toolbar over it, the system bars and the keyboard.
	 */
	const band = () =>
		page.evaluate(() => {
			const cm = app.workspace.activeLeaf.view.editor.cm;
			const s = cm.scrollDOM.getBoundingClientRect();
			const body = getComputedStyle(document.body);
			const px = (v) => parseFloat(body.getPropertyValue(v)) || 0;
			const vv = window.visualViewport;
			let top = Math.max(s.top, vv.offsetTop + px('--safe-area-inset-top'));
			let bottom = Math.min(s.bottom, vv.offsetTop + vv.height - px('--safe-area-inset-bottom'));
			const bars = [cm.dom.closest('.workspace-leaf')?.querySelector('.view-header'), ...document.querySelectorAll('.mobile-navbar, .mobile-toolbar')];
			for (const el of bars) {
				if (!el) continue;
				// Where the bar is when shown: the view header and navigation bar slide away while the note scrolls down.
				const b = el.getBoundingClientRect();
				const t = getComputedStyle(el).transform;
				const slid = t && t !== 'none' ? new DOMMatrixReadOnly(t).m42 : 0;
				const r = { top: b.top - slid, bottom: b.bottom - slid, height: b.height };
				if (r.height <= 0 || r.bottom <= s.top || r.top >= s.bottom) continue;
				if ((r.top + r.bottom) / 2 < (s.top + s.bottom) / 2) top = Math.max(top, r.bottom);
				else bottom = Math.min(bottom, r.top);
			}
			const col = cm.contentDOM.getBoundingClientRect();
			return { top: Math.round(top), bottom: Math.round(bottom), scrollerTop: Math.round(s.top), left: Math.round(col.left), right: Math.round(col.right) };
		});
	/** Scrolls so that document line `line` starts `below` px under the top of the visible band, and lets the bars settle. */
	const showLine = async (line, below = 40) => {
		const b = await band();
		await d.scrollToLine(page, line, b.top - b.scrollerTop + below);
		await d.sleep(500);
	};
	/**
	 * Scrolls so that the image on line `image` and the start of line `target` are both inside the visible band,
	 * away from its auto-scroll edges (48 px). Heights of lines not yet drawn are estimates, so it measures again
	 * once they are drawn.
	 */
	const showBoth = async (image, target) => {
		await showLine(Math.min(image, target), 60);
		const b = await band();
		const ys = [center(await d.geometry(page, image)).y, await d.lineY(page, target)];
		const below = Math.max(...ys) - (b.bottom - 70);
		const above = b.top + 70 - Math.min(...ys);
		const by = below > 0 ? below : above > 0 ? -above : 0;
		if (by !== 0) {
			await page.evaluate((by) => (app.workspace.activeLeaf.view.editor.cm.scrollDOM.scrollTop += by), by);
			await d.sleep(500);
			await d.frames(page, 3);
		}
	};
	const reset = async () => {
		await tp.cancel().catch(() => {});
		await page.keyboard.press('Escape').catch(() => {});
		await d.closeViewer(page);
		await page.evaluate(async (text) => {
			const view = app.workspace.activeLeaf.view;
			if (view.editor.getValue() !== text) view.editor.setValue(text);
			await view.save();
			const cm = view.editor.cm;
			// A cursor away from every image also takes away Obsidian's image selection.
			cm.dispatch({ selection: { anchor: 0 } });
			cm.contentDOM.blur();
		}, original);
		await d.sleep(400);
		await take();
	};
	const center = (g) => ({ x: Math.round(g.img.left + g.img.width / 2), y: Math.round(g.img.top + g.img.height / 2) });
	const clean = (s) => s.bodyClasses.length === 0 && s.overlays === 0 && s.dimmed === 0;
	// Undo holds the view for a second while the note settles (keep-scroll.ts), so the next test waits it out.
	const undo = async () => {
		await page.evaluate(() => app.commands.executeCommandById('editor:undo'));
		await d.sleep(1200);
	};
	/** The text of the line the drop bar is drawn at (the block the image will land above). */
	const lineAtBar = () =>
		page.evaluate(() => {
			const cm = app.workspace.activeLeaf.view.editor.cm;
			const bar = document.querySelector('.itw-drop-bar:not(.is-hidden)');
			if (!bar) return null;
			const y = parseFloat(bar.style.getPropertyValue('--itw-drop-y'));
			const block = cm.lineBlockAtHeight(y - cm.documentTop + 1);
			return cm.state.doc.lineAt(block.from).text;
		});
	const shot = (name) => page.screenshot({ path: `${out}/${name}.png` });
	/** The tops the drop bar is drawn at over `ms` (null while it is hidden), and the scroll position at the end. */
	const sampleBar = async (ms) => {
		const tops = [];
		const end = Date.now() + ms;
		while (Date.now() < end) {
			tops.push((await d.dragState(page)).bar?.top ?? null);
			await d.sleep(80);
		}
		return { tops, scrollTop: (await snap()).scrollTop };
	};
	/** Whether every bar drawn was inside the band `b` (and one was drawn at all). */
	const barsInside = (tops, b) => tops.some((t) => t !== null) && tops.every((t) => t === null || (t >= b.top - 2 && t <= b.bottom + 2));

	let size = '';
	let theme = '';
	const run = async (name, fn) => {
		if (only.length && !only.some((x) => name.includes(x))) return;
		try {
			await reset();
			results.push({ size, theme, name, ...(await fn()) });
		} catch (e) {
			results.push({ size, theme, name, pass: false, evidence: `threw: ${e.stack ?? e}` });
		}
	};

	const tests = async () => {
		await run('a tap still selects the image', async () => {
			await showLine(L.landscape);
			const g = await d.geometry(page, L.landscape);
			const c = center(g);
			await tp.tap(c.x, c.y);
			await d.sleep(500);
			const s = await snap();
			const r = await take();
			const unchanged = (await d.noteText(page)) === original;
			return {
				pass: s.selected.includes(L.landscape) && s.lifted.length === 0 && r.rings === 0 && r.buzz.length === 0 && !s.viewer && !s.menu && unchanged,
				evidence: `selected lines ${JSON.stringify(s.selected)}; lifted=${s.lifted.length}; rings=${r.rings}; buzz=${JSON.stringify(r.buzz)}; viewer=${s.viewer}; unchanged=${unchanged}`,
			};
		});

		await run('a swipe that starts on the image still scrolls the note', async () => {
			await showLine(L.landscape);
			const g = await d.geometry(page, L.landscape);
			const c = center(g);
			const before = (await snap()).scrollTop;
			await tp.swipe(c.x, c.y, c.x, c.y - 220, 10, 16);
			await d.sleep(600);
			const s = await snap();
			const r = await take();
			const drag = await d.dragState(page);
			const unchanged = (await d.noteText(page)) === original;
			return {
				pass: s.scrollTop - before > 100 && s.lifted.length === 0 && r.rings === 0 && clean(drag) && unchanged,
				evidence: `scrollTop ${before} -> ${s.scrollTop}; lifted=${s.lifted.length}; rings=${r.rings}; pointercancels=${r.cancels}; overlays=${drag.overlays}; unchanged=${unchanged}`,
			};
		});

		await run('a long press picks the image up; let go without moving, it stays put and selected', async () => {
			await showLine(L.landscape);
			const g = await d.geometry(page, L.landscape);
			const c = center(g);
			const before = await snap();
			await tp.down(c.x, c.y);
			await d.sleep(HOLD);
			const held = await snap();
			await shot(`${size}-${theme}-lifted`);
			// Held on past Obsidian's own long press (iPhone and iPad), which asks for the image's menu.
			await d.sleep(LONG_HOLD - HOLD);
			const stillHeld = await snap();
			await tp.up();
			await d.sleep(1000);
			const after = await snap();
			const r = await take();
			const drag = await d.dragState(page);
			const unchanged = (await d.noteText(page)) === original;
			const pass =
				held.lifted.includes(L.landscape) &&
				r.rings === 1 &&
				JSON.stringify(r.buzz) === '[50]' &&
				!stillHeld.menu &&
				r.menus === 0 &&
				held.textSelected === '' &&
				stillHeld.textSelected === '' &&
				after.selected.includes(L.landscape) &&
				after.lifted.length === 0 &&
				after.pressed === 0 &&
				!after.viewer &&
				after.scrollTop === before.scrollTop &&
				!after.focused &&
				clean(drag) &&
				unchanged;
			return {
				pass,
				evidence: `held: lifted lines ${JSON.stringify(held.lifted)}, ring shown ${r.rings}x, buzz ${JSON.stringify(r.buzz)}, text selected "${held.textSelected}"; at ${LONG_HOLD} ms: menu=${stillHeld.menu} (menus opened ${r.menus}); after: selected ${JSON.stringify(after.selected)}, lifted ${after.lifted.length}, viewer=${after.viewer}, scrollTop ${before.scrollTop} -> ${after.scrollTop}, keyboard focus=${after.focused}, overlays=${drag.overlays}; unchanged=${unchanged}`,
			};
		});

		await run('a long press on a selected image does not open it', async () => {
			await showLine(L.landscape);
			const g = await d.geometry(page, L.landscape);
			const c = center(g);
			await tp.tap(c.x, c.y);
			await d.sleep(500);
			const selected = (await snap()).selected.includes(L.landscape);
			await tp.longPress(c.x, c.y, HOLD, true);
			await d.sleep(1000);
			const after = await snap();
			const unchanged = (await d.noteText(page)) === original;
			return {
				pass: selected && after.selected.includes(L.landscape) && !after.viewer && !after.menu && unchanged,
				evidence: `selected before=${selected}; after: selected ${JSON.stringify(after.selected)}, viewer=${after.viewer}, menu=${after.menu}; unchanged=${unchanged}`,
			};
		});

		await run('held, the finger drags a wrapped image: ghost above the finger, side by halves, one undo step', async () => {
			await showBoth(L.squareWrapped, L.heading);
			const g = await d.geometry(page, L.squareWrapped);
			const c = center(g);
			await tp.down(c.x, c.y);
			await d.sleep(HOLD);
			const atLift = await snap();
			const b = await band();
			const to = { x: Math.round(b.left + (b.right - b.left) * 0.75), y: Math.round((await d.lineY(page, L.heading)) + 6) };
			await tp.moveTo(c.x, c.y, to.x, to.y, 16, 20);
			await d.sleep(150);
			await d.frames(page, 3);
			const during = await d.dragState(page);
			const moving = await snap();
			const target = await lineAtBar();
			await shot(`${size}-${theme}-dragging`);
			await tp.up();
			await d.sleep(1000);
			const r = await take();
			const after = await snap();
			const text = await d.noteText(page);
			const lines = text.split('\n');
			const link = '![[square.png|wrap-right|180]]';
			const at = lines.indexOf(link);
			const ghost = during.ghost;
			const ghostClear = !!ghost && (ghost.top + ghost.height <= to.y || ghost.top >= to.y) && !(to.x >= ghost.left && to.x <= ghost.left + ghost.width && to.y >= ghost.top && to.y <= ghost.top + ghost.height);
			const landed = at >= 0 && lines[at + 1] === target && !lines.includes('![[square.png|wrap-left|180]]');
			await undo();
			const undone = (await d.noteText(page)) === original;
			const pass =
				ghostClear &&
				!!during.bar &&
				during.label?.text === 'Wrap right' &&
				during.bar.top >= b.top - 2 &&
				during.bar.top <= b.bottom + 2 &&
				moving.scrollTop === atLift.scrollTop &&
				moving.textSelected === '' &&
				r.cancels === 0 &&
				r.moves > 0 &&
				r.prevented === r.moves &&
				landed &&
				!after.viewer &&
				!after.menu &&
				!after.focused &&
				after.selected.length === 0 &&
				undone;
			return {
				pass,
				evidence: `finger at ${to.x},${to.y}; ghost ${JSON.stringify(ghost)} (clear of the finger: ${ghostClear}); label "${during.label?.text}", bar at ${during.bar?.top} in band ${b.top}-${b.bottom}; aimed at "${target?.slice(0, 30)}"; scrollTop at lift ${atLift.scrollTop}, while dragging ${moving.scrollTop}; touchmoves ${r.moves}, cancelled by the plugin ${r.prevented}, pointercancels ${r.cancels}; landed: line ${at} then "${lines[at + 1]?.slice(0, 30)}" (${landed}); after: viewer=${after.viewer}, menu=${after.menu}, keyboard focus=${after.focused}, selected ${JSON.stringify(after.selected)}; one undo restores the note: ${undone}`,
			};
		});

		await run('an image that does not wrap moves as an ordinary image', async () => {
			await showBoth(L.squarePlain, L.topHeading);
			const g = await d.geometry(page, L.squarePlain);
			const c = center(g);
			await tp.down(c.x, c.y);
			await d.sleep(HOLD);
			const held = await snap();
			const b = await band();
			const to = { x: Math.round(b.left + (b.right - b.left) * 0.25), y: Math.round((await d.lineY(page, L.topHeading)) + 6) };
			await tp.moveTo(c.x, c.y, to.x, to.y, 16, 20);
			await d.sleep(150);
			await d.frames(page, 3);
			const during = await d.dragState(page);
			const target = await lineAtBar();
			await tp.up();
			await d.sleep(1000);
			const lines = (await d.noteText(page)).split('\n');
			const at = lines.indexOf('![[square.png|180]]');
			const landed = at > L.squarePlain && lines.slice(at + 1, at + 3).includes('## Top and bottom') && target === '## Top and bottom';
			await undo();
			const undone = (await d.noteText(page)) === original;
			return {
				pass: during.label?.text === 'Move here' && !during.box && landed && undone,
				evidence: `pressed at ${c.x},${c.y}, lifted lines ${JSON.stringify(held.lifted)}; finger to ${to.x},${to.y}; label "${during.label?.text}", outline=${!!during.box}; aimed at "${target}"; landed at line ${at}: ${JSON.stringify(lines.slice(at, at + 3).map((s) => s.slice(0, 30)))}; undone=${undone}`,
			};
		});

		await run('near the bottom and top edges the note scrolls; a cancelled touch cancels', async () => {
			await showLine(L.landscape, 30);
			const g = await d.geometry(page, L.landscape);
			const c = center(g);
			await tp.down(c.x, c.y);
			await d.sleep(HOLD);
			const lift = (await snap()).scrollTop;
			const b = await band();
			const low = b.bottom - 12;
			await tp.moveTo(c.x, c.y, c.x, low, 12, 20);
			const down = await sampleBar(900);
			const high = b.top + 12;
			await tp.moveTo(c.x, low, c.x, high, 12, 20);
			const pressedInPage = await page.evaluate(() => window.__itwM5.pressed?.isConnected);
			const up = await sampleBar(900);
			const bAfter = await band();
			const r = await take();
			await tp.cancel();
			await d.sleep(400);
			const drag = await d.dragState(page);
			const s = await snap();
			const unchanged = (await d.noteText(page)) === original;
			return {
				pass:
					down.scrollTop - lift > 300 &&
					down.scrollTop - up.scrollTop > 300 &&
					barsInside(down.tops, b) &&
					barsInside(up.tops, b) &&
					bAfter.top === b.top &&
					bAfter.bottom === b.bottom &&
					clean(drag) &&
					s.pressed === 0 &&
					unchanged,
				evidence: `visible band ${b.top}-${b.bottom} (after scrolling ${bAfter.top}-${bAfter.bottom}); finger at y=${low}: scrollTop ${lift} -> ${down.scrollTop}, bar drawn at ${JSON.stringify(down.tops)}; finger at y=${high}: -> ${up.scrollTop}, bar at ${JSON.stringify(up.tops)}; after touchcancel: overlays=${drag.overlays}, body classes ${JSON.stringify(drag.bodyClasses)}, dimmed=${drag.dimmed}; unchanged=${unchanged}; the pressed image was still in the page after scrolling down: ${pressedInPage}; events before the touchcancel: ${JSON.stringify(r.ends.filter((e) => !e.includes('touchmove')))}`,
			};
		});

		await run('Escape cancels a drag, and lifting the finger afterwards does nothing', async () => {
			await showLine(L.landscape, 30);
			const g = await d.geometry(page, L.landscape);
			const c = center(g);
			await tp.down(c.x, c.y);
			await d.sleep(HOLD);
			await tp.moveTo(c.x, c.y, c.x + 40, c.y + 140, 10, 20);
			await d.sleep(150);
			const during = await d.dragState(page);
			await page.keyboard.press('Escape');
			await d.sleep(200);
			const cancelled = await d.dragState(page);
			await tp.up();
			await d.sleep(1000);
			const s = await snap();
			const unchanged = (await d.noteText(page)) === original;
			return {
				pass: !!during.ghost && clean(cancelled) && !s.viewer && s.selected.length === 0 && !s.menu && unchanged,
				evidence: `dragging: ghost=${!!during.ghost}; after Escape: overlays=${cancelled.overlays}, body classes ${JSON.stringify(cancelled.bodyClasses)}; after lifting: viewer=${s.viewer}, selected ${JSON.stringify(s.selected)}, menu=${s.menu}; unchanged=${unchanged}`,
			};
		});

		await run('Back cancels a drag: Obsidian going back to the previous note', async () => {
			// The Android Back button makes Obsidian go back in the pane's history (its backButton handler calls
			// history.back() of the active pane); the emulation has no Back button, so that call stands in for it.
			await openNote(page, 'Plain images.md', 'live');
			await openNote(page, d.FIXTURE, 'live');
			await reset();
			await showLine(L.landscape, 30);
			const g = await d.geometry(page, L.landscape);
			const c = center(g);
			await tp.down(c.x, c.y);
			await d.sleep(HOLD);
			await tp.moveTo(c.x, c.y, c.x + 60, c.y + 150, 10, 20);
			await d.sleep(150);
			const during = await d.dragState(page);
			await page.evaluate(() => app.workspace.activeLeaf.history.back());
			await d.sleep(600);
			const cancelled = await d.dragState(page);
			const file = await page.evaluate(() => app.workspace.getActiveFile()?.path);
			await tp.moveTo(c.x + 60, c.y + 150, c.x + 60, c.y + 250, 5, 20);
			await tp.up();
			await d.sleep(800);
			const after = await d.dragState(page);
			await openNote(page, d.FIXTURE, 'live');
			const unchanged = (await d.noteText(page)) === original;
			return {
				pass: !!during.ghost && clean(cancelled) && file === 'Plain images.md' && clean(after) && unchanged,
				evidence: `dragging: ghost=${!!during.ghost}; after going back (now on "${file}"): overlays=${cancelled.overlays}, body classes ${JSON.stringify(cancelled.bodyClasses)}; after lifting: overlays=${after.overlays}; the note it started in unchanged=${unchanged}`,
			};
		});

		await run('with "Move images by dragging" off, a long press does nothing and the finger scrolls', async () => {
			await page.evaluate(async () => {
				const plugin = app.plugins.plugins['image-text-wrap'];
				await plugin.updateSettings({ ...plugin.settings, dragToMove: false });
			});
			try {
				await showLine(L.landscape);
				const g = await d.geometry(page, L.landscape);
				const c = center(g);
				const before = (await snap()).scrollTop;
				await tp.down(c.x, c.y);
				await d.sleep(600);
				const held = await snap();
				await tp.moveTo(c.x, c.y, c.x, c.y - 220, 10, 16);
				await tp.up();
				await d.sleep(600);
				const s = await snap();
				const r = await take();
				const drag = await d.dragState(page);
				const unchanged = (await d.noteText(page)) === original;
				return {
					pass: held.lifted.length === 0 && held.pressed === 0 && r.rings === 0 && !r.buzz.includes(50) && s.scrollTop - before > 100 && clean(drag) && unchanged,
					evidence: `held: lifted=${held.lifted.length}, pressed=${held.pressed}, rings=${r.rings}, buzz ${JSON.stringify(r.buzz)}; scrollTop ${before} -> ${s.scrollTop}; overlays=${drag.overlays}; unchanged=${unchanged}`,
				};
			} finally {
				await page.evaluate(async () => {
					const plugin = app.plugins.plugins['image-text-wrap'];
					await plugin.updateSettings({ ...plugin.settings, dragToMove: true });
				});
			}
		});

		if (size === 'phone') {
			await run('while editing: aims and scrolls above the toolbar and the keyboard, and keeps the keyboard', async () => {
				await showLine(L.landscape - 2, 30);
				// Editing: a tap in the text before the image.
				const textY = Math.round((await d.lineY(page, 2)) + 8);
				const b0 = await band();
				await tp.tap(b0.left + 40, textY);
				await d.sleep(900);
				const editing = await page.evaluate(() => ({ focused: app.workspace.activeLeaf.view.editor.cm.hasFocus, toolbar: document.body.classList.contains('mod-toolbar-open') }));
				// The emulation has no on-screen keyboard: the visual viewport is made to end where one would begin.
				const keyboardTop = 520;
				await page.evaluate((h) => Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => h }), keyboardTop);
				try {
					const g = await d.geometry(page, L.landscape);
					const c = center(g);
					await tp.down(c.x, c.y);
					await d.sleep(HOLD);
					const b = await band();
					const lift = (await snap()).scrollTop;
					await tp.moveTo(c.x, c.y, c.x, b.bottom - 12, 10, 20);
					const near = await sampleBar(800);
					await tp.moveTo(c.x, b.bottom - 12, c.x, b.bottom - 100, 6, 20);
					await d.sleep(200);
					const still1 = (await snap()).scrollTop;
					await d.sleep(400);
					const still2 = (await snap()).scrollTop;
					await tp.up();
					await d.sleep(1000);
					const after = await snap();
					const changed = (await d.noteText(page)) !== original;
					if (changed) await undo();
					return {
						pass: editing.focused && editing.toolbar && b.bottom <= keyboardTop && near.scrollTop - lift > 300 && barsInside(near.tops, b) && still1 === still2 && after.focused,
						evidence: `editing: focus=${editing.focused}, toolbar=${editing.toolbar}; visible band ${b.top}-${b.bottom} with the keyboard from y=${keyboardTop}; finger 12 px above it: scrollTop ${lift} -> ${near.scrollTop}, bar drawn at ${JSON.stringify(near.tops)}; 100 px above: ${still1} -> ${still2}; after the drop the editor keeps the keyboard: ${after.focused}`,
					};
				} finally {
					await page.evaluate(() => delete window.visualViewport.height);
				}
			});
		}
	};

	try {
		for (size of sizes) {
			await setMobile(page, true, size);
			await instrument();
			await openNote(page, d.FIXTURE, 'live');
			for (const [id, name] of themes) {
				theme = name;
				await page.evaluate((t) => app.changeTheme(t), id);
				await d.sleep(300);
				await tests();
			}
		}
	} finally {
		await tp.cancel().catch(() => {});
		await reset().catch(() => {});
		await setMobile(page, false);
		// After the reload that leaving the emulation takes, or the theme is not saved.
		await page.evaluate((t) => app.changeTheme(t ?? 'moonstone'), themeBefore).catch(() => {});
		await d.sleep(1000);
	}

	for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  [${r.size}, ${r.theme}] ${r.name}\n      ${r.evidence}`);
	const failed = results.filter((r) => !r.pass).length;
	console.log(`${results.length - failed}/${results.length} passed`);
	if (errors.length) console.log(`console errors: ${JSON.stringify(errors)}`);
	return undefined;
};
