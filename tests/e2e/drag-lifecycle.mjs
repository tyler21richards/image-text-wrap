// Drag to move: the ways a gesture can end besides a plain drop, in a real Obsidian.
//
//   node scripts/obsidian.mjs run tests/e2e/drag-lifecycle.mjs <screenshot dir>
//
// Gestures use real input (page.mouse, page.keyboard, and one raw CDP mouse move for a missed release).
// page.evaluate measures, flips the setting, unloads the plugin, or edits the note "elsewhere".
import { mkdirSync } from 'node:fs';
import * as d from './drag-lib.mjs';

const LANDSCAPE = 4;
const RAIN = 7;
const SQUARE_WRAPPED = 47; // ![[square.png|wrap-left|180]]
const SQUARE_PLAIN = 50; // ![[square.png|180]], the same image again
const CHANGED_ELSEWHERE = 'The note changed while you were working on the image. Nothing was changed. Please try again.';

export default async ({ page, setWindowSize, openNote, watchErrors, reloadPlugin, args }) => {
	const out = args[0] ?? '.';
	mkdirSync(out, { recursive: true });
	const errors = watchErrors(page);
	const original = d.fixtureText();
	const results = [];
	await setWindowSize(page, 1280, 900);
	await openNote(page, d.FIXTURE, 'live');

	const reset = async () => {
		await page.keyboard.press('Escape');
		await d.resetNote(page, null);
		await page.evaluate(() => {
			const cm = app.workspace.activeLeaf.view.editor.cm;
			cm.dispatch({ selection: { anchor: cm.state.doc.line(3).from } });
		});
	};
	const center = (g) => ({ x: g.img.left + g.img.width / 2, y: g.img.top + g.img.height / 2 });
	const run = async (name, fn) => {
		try {
			results.push({ name, ...(await fn()) });
		} catch (e) {
			results.push({ name, pass: false, evidence: `threw: ${e.stack ?? e}` });
		}
	};
	/** Presses the image on `line` and drags it to just under the top of line `to`, button still down. */
	const startDrag = async (line, to, side = 'right') => {
		await d.scrollToLine(page, Math.max(0, line - 1), 40);
		const g = await d.geometry(page, line);
		const y = await d.lineY(page, to);
		await d.pressAndMove(page, center(g), { x: side === 'right' ? g.column.right - 60 : g.column.left + 60, y: y + 4 }, 10);
		return g;
	};
	const watchDragstart = () =>
		page.evaluate(() => {
			const cm = app.workspace.activeLeaf.view.editor.cm;
			const rec = (window.__itwDragstart = { window: 0, img: 0 });
			const onWindow = (e) => {
				rec.window++;
				// Keep the native drag from dropping anything anywhere; we only want to see who got the event.
				e.preventDefault();
			};
			const onImg = () => rec.img++;
			window.addEventListener('dragstart', onWindow, true);
			const imgs = [...cm.contentDOM.querySelectorAll('.image-embed img')];
			for (const img of imgs) img.addEventListener('dragstart', onImg);
			window.__itwUnwatch = () => {
				window.removeEventListener('dragstart', onWindow, true);
				for (const img of imgs) img.removeEventListener('dragstart', onImg);
				// The drag this probe cancelled never sends a dragend, so leave Obsidian's drag manager as it was.
				document.body.classList.remove('is-grabbing');
				app.dragManager.draggable = null;
			};
		});
	const unwatchDragstart = () =>
		page.evaluate(() => {
			const rec = window.__itwDragstart;
			const grabbing = document.body.classList.contains('is-grabbing');
			const obsidianDrag = !!app.dragManager.draggable;
			window.__itwUnwatch?.();
			return { ...rec, grabbing, obsidianDrag };
		});
	const setDragSetting = (on) =>
		page.evaluate(async (on) => {
			const plugin = app.plugins.plugins['image-text-wrap'];
			await plugin.updateSettings({ ...plugin.settings, dragToMove: on });
		}, on);

	await run('setting on: the native image drag never reaches the image', async () => {
		await reset();
		await watchDragstart();
		await startDrag(LANDSCAPE, RAIN);
		const during = await d.dragState(page);
		await page.keyboard.press('Escape');
		await page.mouse.up();
		await d.sleep(250);
		const seen = await unwatchDragstart();
		const unchanged = (await d.noteText(page)) === original;
		return {
			pass: !!during.bar && seen.img === 0 && !seen.grabbing && !seen.obsidianDrag && unchanged,
			evidence: `our indicator=${!!during.bar}; dragstart events at all=${seen.window}, reaching the image=${seen.img}; Obsidian drag started=${seen.obsidianDrag}; body.is-grabbing=${seen.grabbing}; unchanged=${unchanged}`,
		};
	});

	await run('setting off: nothing followed, Obsidian gets its own image drag', async () => {
		await reset();
		await setDragSetting(false);
		try {
			await watchDragstart();
			await startDrag(LANDSCAPE, RAIN);
			const during = await d.dragState(page);
			await page.mouse.up();
			await d.sleep(250);
			const seen = await unwatchDragstart();
			const unchanged = (await d.noteText(page)) === original;
			// Obsidian's own drag sets its body.is-grabbing meanwhile; that is its behaviour, not ours.
			const ours = during.bodyClasses.filter((c) => c.startsWith('itw-'));
			return {
				pass: !during.bar && ours.length === 0 && during.overlays === 0 && seen.img > 0 && unchanged,
				evidence: `our indicator=${!!during.bar}, our body classes=${ours.join(',') || 'none'} (Obsidian's: ${during.bodyClasses.filter((c) => !c.startsWith('itw-')).join(',') || 'none'}); dragstart reached the image (Obsidian's drag manager)=${seen.img}; unchanged=${unchanged}`,
			};
		} finally {
			await setDragSetting(true);
		}
	});

	await run('plugin unloaded mid-drag: everything removed, nothing written', async () => {
		await reset();
		await startDrag(LANDSCAPE, RAIN);
		const during = await d.dragState(page);
		await page.evaluate(() => app.plugins.disablePlugin('image-text-wrap'));
		await d.sleep(200);
		const afterUnload = await d.dragState(page);
		await page.mouse.move(700, 500, { steps: 3 });
		await page.mouse.up();
		await d.sleep(250);
		const after = await d.dragState(page);
		const unchanged = (await d.noteText(page)) === original;
		await reloadPlugin(page);
		await openNote(page, d.FIXTURE, 'live');
		const ok = !!during.bar && afterUnload.overlays === 0 && afterUnload.bodyClasses.length === 0 && afterUnload.dimmed === 0 && after.cursor === 'auto' && unchanged;
		return {
			pass: ok,
			evidence: `before unload indicator=${!!during.bar}; right after unload: overlays=${afterUnload.overlays} classes=${afterUnload.bodyClasses.join(',') || 'none'} dimmed=${afterUnload.dimmed}; after release cursor=${after.cursor}, unchanged=${unchanged}`,
		};
	});

	await run('missed release (a move with no button held) cancels', async () => {
		await reset();
		await startDrag(LANDSCAPE, RAIN);
		const during = await d.dragState(page);
		const session = await page.context().newCDPSession(page);
		await session.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 700, y: 520, button: 'none', buttons: 0 });
		await d.sleep(150);
		const afterMove = await d.dragState(page);
		await page.mouse.up(); // keep the harness's own button state honest
		await d.sleep(200);
		await session.detach();
		const unchanged = (await d.noteText(page)) === original;
		return {
			pass: !!during.bar && afterMove.overlays === 0 && afterMove.bodyClasses.length === 0 && unchanged,
			evidence: `indicator before=${!!during.bar}; after a move with buttons=0: overlays=${afterMove.overlays} classes=${afterMove.bodyClasses.join(',') || 'none'}; unchanged=${unchanged}`,
		};
	});

	await run('note changed during the drag: nothing written, English notice', async () => {
		await reset();
		await startDrag(LANDSCAPE, RAIN);
		// Another plugin, a sync or a second pane edits the note meanwhile.
		await page.evaluate(() => {
			const cm = app.workspace.activeLeaf.view.editor.cm;
			cm.dispatch({ changes: { from: cm.state.doc.length, insert: '\nAdded elsewhere.' } });
		});
		await d.frames(page, 2);
		await page.mouse.up();
		await d.sleep(300);
		const text = await d.noteText(page);
		const notices = await page.evaluate(() => [...document.querySelectorAll('.notice')].map((n) => n.textContent));
		const ok = text === `${original}\nAdded elsewhere.` && notices.includes(CHANGED_ELSEWHERE);
		return { pass: ok, evidence: `only the other edit is in the note=${text === `${original}\nAdded elsewhere.`}; notices=${JSON.stringify(notices)}` };
	});

	await run('a real click after a drop is not eaten', async () => {
		await reset();
		await startDrag(LANDSCAPE, RAIN);
		await page.mouse.up();
		await d.sleep(400);
		const lines = (await d.noteText(page)).split('\n');
		const at = lines.indexOf('![[landscape.png|wrap-right|300]]');
		const g = await d.geometry(page, at);
		await page.mouse.click(center(g).x, center(g).y);
		await d.sleep(250);
		const selected = await page.evaluate(() => !!document.querySelector('.image-embed.is-selected'));
		await page.keyboard.press('Escape');
		return { pass: at > 0 && selected, evidence: `moved to line ${at}; clicking it afterwards selects it=${selected}` };
	});

	await run('the same image twice: only the dragged copy moves', async () => {
		await reset();
		await d.scrollToLine(page, SQUARE_WRAPPED - 1, 40);
		const g = await d.geometry(page, SQUARE_PLAIN);
		const y = await d.lineY(page, SQUARE_WRAPPED - 2); // "## The same image twice" heading
		await d.pressAndMove(page, center(g), { x: g.column.left + 100, y: y + 4 }, 10);
		await page.mouse.up();
		await d.sleep(300);
		const text = await d.noteText(page);
		const lines = text.split('\n');
		const plainAt = lines.indexOf('![[square.png|180]]');
		// Expected: the plain copy leaves its line (glued to text, so no blank line goes with it) and arrives as
		// a paragraph of its own above the heading (image plus a blank line): one line more in all. Every other
		// line, the wrap-left copy included, is as it was.
		const others = (s) => s.filter((l) => l !== '![[square.png|180]]' && l.trim());
		const othersSame = JSON.stringify(others(lines)) === JSON.stringify(others(original.split('\n')));
		const wrappedStill = lines.filter((l) => l === '![[square.png|wrap-left|180]]').length === 1;
		return {
			pass: wrappedStill && othersSame && plainAt === SQUARE_WRAPPED - 2 && lines[plainAt + 1] === '' && lines[plainAt + 2] === '## The same image twice' && lines.length === original.split('\n').length + 1,
			evidence: `the dragged copy is now on line ${plainAt}, followed by "${lines[plainAt + 1]}" and "${lines[plainAt + 2]}"; the wrap-left copy untouched=${wrappedStill}; every other non-blank line unchanged and in order=${othersSame}`,
		};
	});

	// Images this plugin does not move: inside a transcluded note (display only), and remote or data-URI
	// images (not accepted by editableEmbedFrom in v1). Obsidian keeps its own behaviour for them.
	for (const [name, find, line] of [
		['image inside a transcluded note is display only', '.markdown-embed .image-embed img', 65],
		['remote or data-URI image is left to Obsidian', '.cm-content .image-embed:not(.internal-embed) img', 60],
	]) {
		await run(name, async () => {
			await reset();
			await d.scrollToLine(page, line - 2, 40);
			await d.sleep(500);
			await watchDragstart();
			const rect = await page.evaluate((sel) => {
				const cm = app.workspace.activeLeaf.view.editor.cm;
				const img = [...cm.dom.querySelectorAll(sel)][0];
				if (!img) return null;
				img.scrollIntoView({ block: 'center' });
				return true;
			}, find);
			if (!rect) throw new Error(`no ${find} in the note`);
			await d.sleep(400);
			const box = await page.evaluate((sel) => {
				const img = [...app.workspace.activeLeaf.view.editor.cm.dom.querySelectorAll(sel)][0];
				return img.getBoundingClientRect().toJSON();
			}, find);
			const from = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
			await d.pressAndMove(page, from, { x: from.x - 40, y: from.y - 120 }, 10);
			const during = await d.dragState(page);
			await page.mouse.up();
			await d.sleep(250);
			await unwatchDragstart();
			const unchanged = (await d.noteText(page)) === original;
			return {
				pass: !during.bar && !during.ghost && !during.bodyClasses.includes('itw-dragging') && unchanged,
				evidence: `pressed and moved 126px: our indicator=${!!during.bar}, ghost=${!!during.ghost}, our body class=${during.bodyClasses.includes('itw-dragging')}; note unchanged=${unchanged}`,
			};
		});
	}

	await reset();
	for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.name}\n      ${r.evidence}`);
	if (errors.length) console.log(`console errors: ${JSON.stringify(errors)}`);
	return undefined;
};
