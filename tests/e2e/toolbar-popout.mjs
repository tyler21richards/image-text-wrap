// M2 acceptance, part 5: a pop-out window, light and dark themes, and plugin unload cleanup.
//   node scripts/obsidian.mjs run tests/e2e/toolbar-popout.mjs
// Screenshots go to $ITW_STATE_DIR/toolbar-*.png.
import { clickText, closeLightbox, diffLines, freshNote, geometryProblems, imageRect, probe, showImage, sleep, sourceNote, state } from './toolbar-helpers.mjs';

const OUT = process.env.ITW_STATE_DIR ?? '.';

/** The toolbar and selection as seen from inside one window's own document. */
function windowState(p) {
	return p.evaluate(() => {
		const tb = [...document.querySelectorAll('.itw-toolbar')].find((t) => !t.classList.contains('itw-toolbar-hidden'));
		const sel = document.querySelector('.cm-content .image-embed.is-selected');
		const r = (el) => {
			const b = el.getBoundingClientRect();
			return { left: Math.round(b.left), top: Math.round(b.top), right: Math.round(b.right), bottom: Math.round(b.bottom) };
		};
		return {
			toolbars: document.querySelectorAll('.itw-toolbar').length,
			inBody: !!tb && tb.parentElement === document.body,
			visible: !!tb,
			placement: tb?.dataset.placement ?? null,
			toolbar: tb ? r(tb) : null,
			buttons: tb ? [...tb.querySelectorAll('button')].map((b) => ({ label: b.getAttribute('aria-label'), pressed: b.getAttribute('aria-pressed'), rect: r(b) })) : [],
			selected: !!sel,
			native: sel ? [...sel.querySelectorAll('.image-resize-corner, .embed-actions, .edit-block-button')].map((e) => ({ cls: e.className, ...r(e) })) : [],
			picture: sel ? r(sel.querySelector('img')) : null,
		};
	});
}

export default probe(async (h, check, restore) => {
	const { page } = h;
	const errors = h.watchErrors(page);
	await h.setWindowSize(page, 1280, 900);
	await freshNote(page, h, 'Fixture.md');

	// Pop-out window. The plugin's own cleanup list and child components are counted around it: whatever
	// it registers for the window must be released when the window closes.
	const pagesBefore = new Set(page.context().pages());
	const owned = () =>
		page.evaluate(() => {
			const plugin = app.plugins.plugins['image-text-wrap'];
			return { events: plugin._events.length, children: plugin._children.length };
		});
	const ownedBefore = await owned();
	// A run that stops early closes the pop-out too, so the next probe does not connect to it.
	restore(() =>
		page.evaluate(() => {
			window.__itwPopout?.detach();
			delete window.__itwPopout;
			window.dispatchEvent(new Event('focus'));
		}),
	);
	await page.evaluate(async () => {
		const leaf = app.workspace.openPopoutLeaf({ size: { width: 1000, height: 800 } });
		await leaf.openFile(app.vault.getAbstractFileByPath('Fixture.md'), { state: { mode: 'source', source: false }, active: true });
		window.__itwPopout = leaf;
	});
	await sleep(1500);
	let pop = null;
	for (const ctx of page.context().browser().contexts()) {
		for (const p of ctx.pages()) {
			if (pagesBefore.has(p) || p === page) continue;
			if (await p.evaluate(() => !!document.querySelector('.cm-content')).catch(() => false)) pop = p;
		}
	}
	check('pop-out window opened as its own page', !!pop, { pages: page.context().pages().length });
	if (pop) {
		// Focus emulation, as for the main window: the pop-out must not be brought forward, where it would take
		// the keyboard from whoever is using the computer.
		const popSession = await pop.context().newCDPSession(pop).catch(() => null);
		await popSession?.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
		const target = await pop.evaluate(() => {
			const cm = [...document.querySelectorAll('.cm-editor')].map((e) => e.cmView?.view ?? null).find(Boolean);
			const img = [...document.querySelectorAll('.cm-content .internal-embed.image-embed img')].find((i) => {
				const b = i.getBoundingClientRect();
				return b.top > 80 && b.bottom < window.innerHeight - 20 && b.width > 0;
			});
			if (!img) return null;
			const b = img.getBoundingClientRect();
			return { x: b.left + 30, y: b.top + b.height / 2, alt: img.closest('.image-embed').getAttribute('alt'), viaView: !!cm };
		});
		check('pop-out: an image is on screen', !!target, target);
		if (target) {
			await pop.mouse.click(target.x, target.y);
			await sleep(500);
			let ps = await windowState(pop);
			const ms = await windowState(page);
			check('pop-out: toolbar appears in the pop-out window\'s own document', ps.selected && ps.visible && ps.inBody && ps.toolbars === 1, ps);
			check('pop-out: toolbar clear of the native controls', ps.visible && ps.native.every((n) => !(ps.toolbar.left < n.right && n.left < ps.toolbar.right && ps.toolbar.top < n.bottom && n.top < ps.toolbar.bottom)), { toolbar: ps.toolbar, native: ps.native });
			check('pop-out: main window shows no toolbar meanwhile', !ms.visible, ms);
			await pop.screenshot({ path: `${OUT}/toolbar-popout.png` });
			// The pop-out editor's own text (the file on disk is saved a moment later).
			const popText = () => page.evaluate(() => window.__itwPopout.view.editor.getValue());
			const before = await popText();
			const right = ps.buttons.find((b) => b.label === 'Wrap text right');
			await pop.mouse.click((right.rect.left + right.rect.right) / 2, (right.rect.top + right.rect.bottom) / 2);
			await sleep(700);
			ps = await windowState(pop);
			const diff = diffLines(before, await popText());
			check('pop-out: a button click writes only that link, image stays selected', diff.length === 1 && diff[0].line === 5 && diff[0].after === '![[landscape.png|wrap-right|300]]' && ps.selected && ps.buttons.find((b) => b.label === 'Wrap text right')?.pressed === 'true', { diff, pressed: ps.buttons.filter((b) => b.pressed === 'true').map((b) => b.label) });
			await pop.keyboard.press('Meta+z');
			await sleep(500);
			check('pop-out: Cmd+Z in the pop-out undoes it', (await popText()) === before, diffLines(before, await popText()));

			// Esc with the pointer resting on a button: its tooltip goes with the toolbar in the pop-out too.
			ps = await windowState(pop);
			const block = ps.buttons.find((b) => b.label === 'Top and bottom');
			await pop.mouse.move(block.rect.left + 3, block.rect.top - 20, { steps: 3 });
			await sleep(200);
			await pop.mouse.move((block.rect.left + block.rect.right) / 2, (block.rect.top + block.rect.bottom) / 2, { steps: 5 });
			await sleep(1300);
			const popTips = () => pop.evaluate(() => [...document.querySelectorAll('.tooltip')].map((t) => t.textContent));
			const tipBefore = await popTips();
			await pop.keyboard.press('Escape');
			await sleep(300);
			const tipAfter = await popTips();
			check('pop-out: Esc with the pointer on a button hides the toolbar and its tooltip', tipBefore.join() === 'Top and bottom' && tipAfter.length === 0 && !(await windowState(pop)).visible, { tipBefore, tipAfter });
			await pop.mouse.move(target.x, target.y + 120, { steps: 3 });

			// A real right-click in the pop-out: the layout entries are in Obsidian's menu there too.
			const nativeBefore = await page.evaluate(() => app.vault.getConfig('nativeMenus'));
			restore(() => page.evaluate((v) => app.vault.setConfig('nativeMenus', v), nativeBefore));
			await page.evaluate(() => app.vault.setConfig('nativeMenus', false));
			await pop.mouse.click(target.x - 22, target.y, { button: 'right' });
			await sleep(500);
			const popMenu = await pop.evaluate(() => [...document.querySelectorAll('.menu .menu-item-title')].map((t) => t.textContent));
			await pop.keyboard.press('Escape');
			await sleep(300);
			await page.evaluate((v) => app.vault.setConfig('nativeMenus', v), nativeBefore);
			check('pop-out: right-click menu has the layout entries, once', ['In line with text', 'Wrap text left', 'Wrap text right', 'Top and bottom'].every((t) => popMenu.filter((m) => m === t).length === 1), popMenu);

			// Obsidian's image viewer opens in its active window, here the pop-out (Obsidian's own focus handler
			// makes it the active one): its title shows no layout words there either.
			await pop.evaluate(() => window.dispatchEvent(new Event('focus')));
			const popViewer = () =>
				pop.evaluate(() => {
					const box = document.querySelector('.lightbox');
					return box ? { title: box.querySelector('.lightbox-titlebar-text')?.textContent ?? null, alts: [...box.querySelectorAll('.lightbox-media img')].map((i) => i.getAttribute('alt')) } : null;
				});
			// A click selects the picture, a click on the selected picture opens the viewer.
			for (let i = 0; i < 2 && !(await popViewer()); i++) {
				await pop.mouse.click(target.x, target.y);
				await sleep(700);
			}
			const shown = await popViewer();
			const layoutWords = /(^|\|)(wrap-(left|right|block)|gap-(0|8|16|24))(\||$)/;
			check(
				'pop-out: the image viewer opens there, titled without layout words',
				!!shown && !!shown.title && !layoutWords.test(shown.title) && shown.alts.every((a) => !layoutWords.test(a ?? '')),
				{ pictureAlt: target.alt, viewer: shown },
			);
			const close = await pop.evaluate(() => {
				const b = document.querySelector('.lightbox .modal-close-button')?.getBoundingClientRect();
				return b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null;
			});
			if (close) await pop.mouse.click(close.x, close.y);
			await sleep(500);
		}
		await popSession?.detach().catch(() => {});
		await page.evaluate(() => window.__itwPopout.detach());
		await sleep(800);
		// With the DevTools connection attached, the emptied pop-out window can stay open (Obsidian has already
		// dropped it from the workspace); a window left open would be picked up by the next probe's connect().
		for (let i = 0; i < 10 && !pop.isClosed(); i++) await sleep(300);
		const orphan = !pop.isClosed();
		if (orphan) await pop.evaluate(() => setTimeout(() => window.electronWindow?.destroy(), 50)).catch(() => {});
		await sleep(1000);
		const leaves = await page.evaluate(() => (app.workspace.floatingSplit?.children ?? []).length);
		check('pop-out window closed', pop.isClosed() && leaves === 0, { closedByObsidian: !orphan, closedAfterDestroy: pop.isClosed(), floatingWindowsLeft: leaves });
		// A window kept open by the DevTools connection can take focus after Obsidian let go of it; Obsidian's
		// own focus handler makes the main window the active one again (notices and menus go there).
		await page.evaluate(() => window.dispatchEvent(new Event('focus')));
		// Had the viewer opened in the main window instead, it would cover the next steps.
		await closeLightbox(page);
		const ownedAfter = await owned();
		check('closing the pop-out releases what the plugin registered for it', JSON.stringify(ownedAfter) === JSON.stringify(ownedBefore), { before: ownedBefore, after: ownedAfter });
		// (Whether the closed window's document is then garbage-collected is not checked here: the editor code
		// Obsidian ships can keep the last closed window alive for a while by itself. Heap snapshots on 1.14.4
		// showed two such paths, neither through this plugin: CodeMirror's scratch Range for measuring text,
		// last used in the pop-out; and a CodeMirror widget-buffer image made with the main window's document,
		// moved into the pop-out, still listed by the main document's MediaQueryMatcher.)
		await page.evaluate(() => delete window.__itwPopout);
	}
	const after = await page.evaluate(() => document.querySelectorAll('.itw-toolbar').length);
	check('closing the pop-out leaves one toolbar element (main window only)', after === 1, { mainWindowToolbars: after });

	// Light and dark themes: the toolbar and the menus use Obsidian's colours.
	const themeBefore = await page.evaluate(() => app.vault.getConfig('theme'));
	restore(() => page.evaluate((t) => app.changeTheme(t ?? 'moonstone'), themeBefore));
	await h.setNote(page, 'Fixture.md', sourceNote('Fixture.md'));
	for (const [theme, name] of [
		['moonstone', 'light'],
		['obsidian', 'dark'],
	]) {
		await page.evaluate((t) => app.changeTheme(t), theme);
		await sleep(500);
		await freshNote(page, h, 'Fixture.md');
		const img = await showImage(page, '![[square.png|wrap-left|180]]');
		await page.mouse.click(img.x, img.y);
		await sleep(450);
		const s = await state(page);
		const colours = await page.evaluate(() => {
			const tb = [...document.querySelectorAll('.itw-toolbar')].find((t) => !t.classList.contains('itw-toolbar-hidden'));
			const active = tb.querySelector('.is-active');
			const idle = tb.querySelector('button:not(.is-active)');
			const cs = (el) => getComputedStyle(el);
			return {
				body: document.body.className.match(/theme-\w+/)?.[0],
				toolbarBg: cs(tb).backgroundColor,
				pageBg: getComputedStyle(document.querySelector('.workspace-leaf.mod-active .view-content')).backgroundColor,
				activeBg: cs(active).backgroundColor,
				activeFg: cs(active).color,
				idleFg: cs(idle).color,
				accent: cs(document.body).getPropertyValue('--interactive-accent').trim(),
			};
		});
		check(`${name} theme: toolbar shown with theme colours`, s.visible && geometryProblems(s).length === 0 && colours.toolbarBg === colours.pageBg, colours);
		await page.screenshot({ path: `${OUT}/toolbar-${name}.png` });
		// The spacing dropdown and the right-click menu in this theme.
		const spacing = s.buttons.find((b) => b.label.startsWith('Spacing'));
		await page.mouse.click((spacing.rect.left + spacing.rect.right) / 2, (spacing.rect.top + spacing.rect.bottom) / 2);
		await sleep(400);
		await page.screenshot({ path: `${OUT}/toolbar-${name}-spacing.png` });
		await page.keyboard.press('Escape');
		await sleep(300);
		await clickText(page);
	}
	await page.evaluate((t) => app.changeTheme(t ?? 'moonstone'), themeBefore);

	// Unload removes every toolbar element and its listeners; reload brings it back.
	const unload = await page.evaluate(async () => {
		await app.plugins.disablePlugin('image-text-wrap');
		const left = document.querySelectorAll('.itw-toolbar').length;
		await app.plugins.enablePlugin('image-text-wrap');
		return { toolbarsAfterUnload: left };
	});
	await sleep(500);
	check('plugin unload removes the toolbar element', unload.toolbarsAfterUnload === 0, unload);
	await freshNote(page, h, 'Plain images.md');
	const img = await imageRect(page, '![[landscape.png|320]]');
	await page.mouse.click(img.x, img.y);
	await sleep(400);
	check('after re-enabling, the toolbar works again', (await state(page)).visible, {});

	check('no console errors', errors.length === 0, errors);
});
