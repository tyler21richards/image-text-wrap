// M5, phones and tablets: the picture toolbar as a sheet docked at the bottom of the screen.
//   node scripts/obsidian.mjs run tests/e2e/mobile-toolbar-sheet.mjs [phone|tablet] [light|dark]
// With no arguments it runs phone and tablet, each in the light and the dark theme. Obsidian runs in its own
// mobile emulation (tests/e2e/mobile.mjs), and every tap, long press and swipe is real touch input sent over
// the DevTools protocol. The keyboard cannot open in emulation: Obsidian's report of it (--keyboard-height)
// and a shrinking visual viewport are imitated, and labelled so.
import { setMobile, touch } from './mobile.mjs';
import { diffLines, probe, scrollToLink, sleep, sourceNote, waitFor, waitForImage } from './toolbar-helpers.mjs';

const NOTE = 'Plain images.md';
const OTHER = 'Fixture.md';
const LINK = '![[landscape.png|320]]';
const TALL = '![[tall.png]]';
const LINE = 5; // LINK's line in NOTE (1-based)
const CHOICES = ['In line', 'Wrap left', 'Wrap right', 'Top and bottom'];
const SEGMENTS = ['None', 'Small', 'Medium', 'Large'];
const HINT = 'Choose a wrap option first';
const GAP = 8;
/** Where the screenshots go: ITW_SHOTS_DIR, else ITW_STATE_DIR, else the current folder. */
const SHOTS = process.env.ITW_SHOTS_DIR ?? process.env.ITW_STATE_DIR ?? '.';

/** Everything the probe checks about the sheet, the selected image, the editor and Obsidian's bars, in one read. */
function state(page) {
	return page.evaluate(() => {
		const rect = (el) => {
			const r = el.getBoundingClientRect();
			return { left: Math.round(r.left), top: Math.round(r.top), right: Math.round(r.right), bottom: Math.round(r.bottom), width: Math.round(r.width), height: Math.round(r.height) };
		};
		/** A theme variable as the browser resolves it for a background, e.g. "rgb(255, 255, 255)". */
		const resolve = (name) => {
			const probe = document.body.createDiv();
			probe.style.backgroundColor = `var(${name})`;
			const value = getComputedStyle(probe).backgroundColor;
			probe.remove();
			return value;
		};
		const cm = app.workspace.activeLeaf.view.editor?.cm;
		const sheet = document.querySelector('.itw-sheet');
		const sheetStyle = sheet && getComputedStyle(sheet);
		const sel = cm?.contentDOM.querySelector('.image-embed.is-selected');
		let selPos = null;
		try {
			selPos = sel ? cm.posAtDOM(sel) : null;
		} catch {
			/* detached */
		}
		const nav = document.querySelector('.mobile-navbar');
		const navShown = nav && nav.getBoundingClientRect().height > 0;
		const mt = document.querySelector('.mobile-toolbar');
		const header = cm?.dom.closest('.workspace-leaf-content')?.querySelector('.view-header');
		const hint = sheet?.querySelector('.itw-sheet-spacing-hint');
		const active = document.activeElement;
		return {
			sheetCount: document.querySelectorAll('.itw-sheet').length,
			shown: !!sheet && !sheet.classList.contains('itw-sheet-hidden') && sheetStyle.visibility === 'visible',
			sheet: sheet ? rect(sheet) : null,
			sheetBg: sheetStyle?.backgroundColor ?? null,
			sheetColor: sheetStyle?.color ?? null,
			zIndex: sheetStyle?.zIndex ?? null,
			buttons: sheet
				? [...sheet.querySelectorAll('button')].map((b) => {
						const label = b.querySelector('.itw-sheet-choice-label') ?? b;
						const ls = getComputedStyle(label);
						return {
							text: b.textContent,
							pressed: b.getAttribute('aria-pressed'),
							disabled: b.getAttribute('aria-disabled') === 'true',
							rect: rect(b),
							labelShown: label.getBoundingClientRect().width > 0 && ls.visibility === 'visible' && ls.color !== 'rgba(0, 0, 0, 0)',
							bg: getComputedStyle(b).backgroundColor,
							color: ls.color,
							icon: !!b.querySelector('svg'),
						};
					})
				: [],
			hint: hint ? { text: hint.textContent, visible: getComputedStyle(hint).visibility === 'visible' } : null,
			theme: document.body.classList.contains('theme-dark') ? 'dark' : 'light',
			colors: { background: resolve('--background-primary'), accent: resolve('--interactive-accent'), text: resolve('--text-normal') },
			desktopToolbar: [...document.querySelectorAll('.itw-toolbar')].some((t) => !t.classList.contains('itw-toolbar-hidden')),
			selected: !!sel,
			selPos,
			picture: sel ? rect(sel.querySelector('img') ?? sel) : null,
			scrollTop: cm?.scrollDOM.scrollTop ?? null,
			hasFocus: cm?.hasFocus ?? null,
			editableFocused: !!active && (active.isContentEditable || active.tagName === 'INPUT' || active.tagName === 'TEXTAREA'),
			cursor: cm ? [cm.state.selection.main.anchor, cm.state.selection.main.head] : null,
			doc: cm?.state.doc.toString() ?? null,
			navbar: navShown ? rect(nav) : null,
			mobileToolbar: mt ? rect(mt) : null,
			header: header && header.getBoundingClientRect().height > 0 ? rect(header) : null,
			width: innerWidth,
			height: innerHeight,
			safeBottom: parseFloat(getComputedStyle(document.body).getPropertyValue('--safe-area-inset-bottom')) || 0,
			lightbox: !!document.querySelector('.lightbox'),
			menus: document.querySelectorAll('.menu').length,
			body: document.body.className,
		};
	});
}

const centre = (r) => ({ x: (r.left + r.right) / 2, y: (r.top + r.bottom) / 2 });

/** The lowest point a tap on the note may use: above the navigation bar, the safe area and the sheet. */
function noteBottom(s) {
	let bottom = s.height - s.safeBottom;
	if (s.navbar) bottom = Math.min(bottom, s.navbar.top);
	if (s.mobileToolbar) bottom = Math.min(bottom, s.mobileToolbar.top);
	if (s.shown) bottom = Math.min(bottom, s.sheet.top);
	return bottom;
}

/** The highest point a tap on the note may use: below the note's header bar. */
const noteTop = (s) => Math.max(s.header ? s.header.bottom : 0, 0);

export default probe(async (h, check, restore) => {
	const { page, args } = h;
	const errors = h.watchErrors(page);
	const sizes = args[0] ? [args[0]] : ['phone', 'tablet'];
	const themes = args[1] ? [args[1]] : ['light', 'dark'];
	const plugin = () => page.evaluate(() => app.plugins.plugins['image-text-wrap'].settings);
	const settings = await plugin();
	const theme = await page.evaluate(() => app.vault.getConfig('theme'));
	const original = sourceNote(NOTE);
	// Run last first: the theme goes back once the window has left emulation (which reloads it), so the
	// change is saved rather than lost in the reload.
	restore(async () => {
		await page.evaluate((t) => app.changeTheme(t), theme);
		await sleep(1500);
	});
	restore(() => setMobile(page, false));
	restore(() => page.evaluate((s) => app.plugins.plugins['image-text-wrap'].updateSettings(s), settings));
	restore(() => h.setNote(page, NOTE, original));
	restore(() =>
		page.evaluate(() => {
			document.documentElement.style.removeProperty('--keyboard-height');
			delete window.visualViewport.height;
			app.workspace.leftSplit.collapse();
		}),
	);

	const t = touch(page);
	const tap = async (p, ms = 450) => {
		await t.tap(p.x, p.y);
		await sleep(ms);
	};

	/** Closes Obsidian's image viewer with a tap on its close button, if a step opened it. */
	async function closeViewer() {
		for (let i = 0; i < 3; i++) {
			const p = await page.evaluate(() => {
				const box = document.querySelector('.lightbox');
				const close = box && [...box.querySelectorAll('.lightbox-titlebar .clickable-icon, .lightbox-titlebar button')].pop();
				if (!close) return null;
				const r = close.getBoundingClientRect();
				return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
			});
			if (!p) return;
			await tap(p, 500);
		}
	}

	/** Taps plain text in the note, clear of the bars and the sheet (this deselects any image). */
	async function tapText() {
		const s = await state(page);
		const p = await page.evaluate(
			({ top, bottom }) => {
				const cm = app.workspace.activeLeaf.view.editor.cm;
				for (const l of cm.contentDOM.querySelectorAll('.cm-line')) {
					const r = l.getBoundingClientRect();
					if (l.querySelector('.image-embed, .cm-embed-block') || l.textContent.length < 40) continue;
					if (r.top < top + 10 || r.top + 20 > bottom - 10) continue;
					const x = r.left + 30;
					const y = r.top + 10;
					const hit = document.elementFromPoint(x, y);
					if (hit && hit.closest('.cm-line') === l && !hit.closest('.image-embed')) return { x, y };
				}
				return null;
			},
			{ top: noteTop(s), bottom: noteBottom(s) },
		);
		if (!p) throw new Error('no plain text on screen to tap');
		await tap(p);
	}

	/**
	 * Deselects any image and leaves the editor without focus, as a phone is after a tap on text once the
	 * keyboard is put away. (In emulation a tap on text focuses the editor and shows Obsidian's editing
	 * toolbar, with no keyboard.)
	 */
	async function deselect() {
		await closeViewer();
		await page.evaluate(() => {
			app.workspace.activeLeaf.view.editor.cm.scrollDOM.scrollTop = 0;
		});
		await sleep(400);
		await tapText();
		await page.evaluate(() => app.workspace.activeLeaf.view.editor.cm.contentDOM.blur());
		await sleep(400);
	}

	/** Scrolls the picture of `needle` so its top is at `top` (window px) and returns its rectangle once still. */
	async function placePicture(needle, top) {
		await scrollToLink(page, needle, 0, 'center');
		await sleep(300);
		let r = await waitForImage(page, needle);
		if (!r.found) throw new Error(`${needle} is not drawn`);
		await page.evaluate((by) => {
			app.workspace.activeLeaf.view.editor.cm.scrollDOM.scrollTop += by;
		}, r.top - top);
		await sleep(300);
		r = await waitForImage(page, needle);
		if (!r.found) throw new Error(`${needle} is not drawn after scrolling`);
		return r;
	}

	/** Taps the part of the picture that is on screen, clear of the bars (and of the sheet if it is shown). */
	async function tapPicture(r) {
		const s = await state(page);
		const top = Math.max(r.top, noteTop(s)) + 10;
		const bottom = Math.min(r.bottom, noteBottom(s)) - 10;
		if (bottom <= top) throw new Error(`no part of the picture is free to tap (${JSON.stringify({ r, top, bottom })})`);
		await tap({ x: (r.left + r.right) / 2, y: Math.min((top + bottom) / 2, top + 60) }, 700);
	}

	/** Taps a sheet button by its visible text. */
	async function tapButton(text, ms = 450) {
		const s = await state(page);
		const b = s.buttons.find((x) => x.text === text);
		if (!b) throw new Error(`no sheet button "${text}" (have ${s.buttons.map((x) => x.text).join(', ')})`);
		await tap(centre(b.rect), ms);
	}

	const pressed = (s) => s.buttons.filter((b) => b.pressed === 'true').map((b) => b.text);
	const line = (s) => s.doc.split('\n')[LINE - 1];

	/** The sheet's place: above the bars and keyboard, inside the safe area, full width or a centred card. */
	function placeProblems(s, size) {
		const out = [];
		if (!s.shown) return ['not shown'];
		if (s.sheet.bottom > s.height - s.safeBottom - GAP + 1) out.push(`below the safe area (${s.sheet.bottom} > ${s.height - s.safeBottom - GAP})`);
		if (s.navbar && s.sheet.bottom > s.navbar.top - GAP + 1) out.push(`covers the navigation bar (${s.sheet.bottom} > ${s.navbar.top})`);
		if (s.mobileToolbar && s.sheet.bottom > s.mobileToolbar.top - GAP + 1) out.push(`covers the editing toolbar (${s.sheet.bottom} > ${s.mobileToolbar.top})`);
		if (s.sheet.left < 0 || s.sheet.right > s.width) out.push('off screen');
		if (size === 'phone' && (s.sheet.left > GAP + 1 || s.sheet.right < s.width - GAP - 1)) out.push(`not full width (${s.sheet.left}..${s.sheet.right} of ${s.width})`);
		if (size === 'tablet' && (s.sheet.width > 481 || Math.abs(s.sheet.left - (s.width - s.sheet.right)) > 1)) out.push(`not a centred card (${s.sheet.left}..${s.sheet.right} of ${s.width})`);
		return out;
	}

	for (const size of sizes) {
		await setMobile(page, true, size);
		for (const th of themes) {
			const tag = `${size}, ${th}:`;
			await page.evaluate((th) => app.changeTheme(th === 'dark' ? 'obsidian' : 'moonstone'), th);
			await page.keyboard.press('Escape');
			await closeViewer();
			await h.setNote(page, NOTE, original);
			await h.openNote(page, OTHER, 'live');
			await h.openNote(page, NOTE, 'live');
			await page.evaluate(() => {
				app.workspace.activeLeaf.view.editor.cm.scrollDOM.scrollTop = 0;
			});
			await sleep(400);
			await deselect();

			// ---- Shows on a tap, in place of the floating toolbar ----
			let s0 = await state(page);
			let img = await placePicture(LINK, noteTop(s0) + 120);
			s0 = await state(page);
			await tapPicture(img);
			let s = await state(page);
			check(`${tag} a tap on a picture selects it and shows the sheet, not the floating toolbar`, s.selected && s.shown && !s.desktopToolbar && s.sheetCount === 1, {
				selected: s.selected,
				shown: s.shown,
				desktopToolbar: s.desktopToolbar,
				theme: s.theme,
				body: s.body,
			});
			check(`${tag} the tap neither focuses the editor nor moves the cursor`, !s.hasFocus && !s.editableFocused && JSON.stringify(s.cursor) === JSON.stringify(s0.cursor), { hasFocus: s.hasFocus, cursor: [s0.cursor, s.cursor] });
			check(`${tag} sits above the navigation bar, inside the safe area; ${size === 'phone' ? 'full width' : 'a centred card'}`, placeProblems(s, size).length === 0, {
				problems: placeProblems(s, size),
				sheet: s.sheet,
				navbar: s.navbar,
				height: s.height,
				safeBottom: s.safeBottom,
			});
			check(`${tag} a picture clear of the sheet does not scroll`, s.scrollTop === s0.scrollTop, [s0.scrollTop, s.scrollTop]);
			check(
				`${tag} four layout buttons with icon and visible label, four spacing segments, in English`,
				JSON.stringify(s.buttons.map((b) => b.text)) === JSON.stringify([...CHOICES, ...SEGMENTS]) && s.buttons.every((b) => b.labelShown) && s.buttons.slice(0, 4).every((b) => b.icon),
				s.buttons.map((b) => [b.text, b.labelShown, b.icon]),
			);
			check(`${tag} every touch target is at least 44 x 44 px`, s.buttons.every((b) => b.rect.width >= 44 && b.rect.height >= 44), s.buttons.map((b) => [b.text, b.rect.width, b.rect.height]));
			const strings = await page.evaluate(() => {
				const sheet = document.querySelector('.itw-sheet');
				const labels = [sheet, ...sheet.querySelectorAll('[aria-label]')].map((el) => el.getAttribute('aria-label'));
				return [...new Set([...sheet.innerText.split('\n'), ...labels].map((x) => x?.trim()).filter(Boolean))];
			});
			check(`${tag} every string on the sheet is plain English`, strings.every((x) => /^[A-Za-z0-9 ():.,'-]+$/.test(x)), strings);
			check(`${tag} "In line" pressed; spacing disabled with the explanation shown`, pressed(s).join() === 'In line' && s.buttons.slice(4).every((b) => b.disabled) && s.hint?.visible && s.hint.text === HINT, { pressed: pressed(s), hint: s.hint });
			const dark = th === 'dark';
			const lum = (rgb) => {
				const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).map(Number);
				return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
			};
			const pressedButton = s.buttons.find((b) => b.pressed === 'true');
			check(
				`${tag} drawn in the theme's colours (background, text, accent on the pressed button)`,
				s.theme === th && s.sheetBg === s.colors.background && s.sheetColor === s.colors.text && pressedButton.bg === s.colors.accent && (dark ? lum(s.sheetBg) < 0.3 : lum(s.sheetBg) > 0.7),
				{ theme: s.theme, sheetBg: s.sheetBg, sheetColor: s.sheetColor, colors: s.colors, pressedBg: pressedButton.bg },
			);
			await page.screenshot({ path: `${SHOTS}/mobile-sheet-${size}-${th}.png` });

			// ---- Spacing is disabled while in line ----
			await tapButton('Large');
			s = await state(page);
			check(`${tag} a disabled spacing segment changes nothing`, s.doc === original && s.shown && s.selected, diffLines(original, s.doc));

			// ---- Every choice: only this link, one undo step, no scrolling, no focus, no cursor move ----
			const docs = [s.doc];
			const actions = [
				['Wrap left', '![[landscape.png|wrap-left|320]]', 'Wrap left', 'Medium'],
				['Wrap left', LINK, 'In line', null], // tapping the pressed wrap choice returns to in line
				['Wrap right', '![[landscape.png|wrap-right|320]]', 'Wrap right', 'Medium'],
				['Large', '![[landscape.png|wrap-right|gap-24|320]]', 'Wrap right', 'Large'],
				['Small', '![[landscape.png|wrap-right|gap-8|320]]', 'Wrap right', 'Small'],
				['Top and bottom', '![[landscape.png|wrap-block|gap-8|320]]', 'Top and bottom', 'Small'],
				['In line', LINK, 'In line', null],
			];
			for (const [label, expected, wantWrap, wantGap] of actions) {
				const before = await state(page);
				await tapButton(label);
				const after = await state(page);
				const diff = diffLines(before.doc, after.doc);
				check(`${tag} "${label}" changes only this link`, diff.length === 1 && diff[0].line === LINE && line(after) === expected, diff);
				check(`${tag} "${label}" keeps the picture selected and the sheet in step`, after.selected && after.shown && after.selPos === img.pos && pressed(after).join() === [wantWrap, wantGap].filter(Boolean).join(), {
					selected: after.selected,
					shown: after.shown,
					pressed: pressed(after),
				});
				check(`${tag} "${label}" does not scroll, focus the editor or move the cursor`, after.scrollTop === before.scrollTop && !after.hasFocus && !after.editableFocused && JSON.stringify(after.cursor) === JSON.stringify(before.cursor), {
					scrollTop: [before.scrollTop, after.scrollTop],
					hasFocus: after.hasFocus,
					cursor: [before.cursor, after.cursor],
				});
				check(`${tag} "${label}": the spacing explanation shows only while in line`, after.hint.visible === (wantWrap === 'In line') && after.buttons.slice(4).every((b) => b.disabled === (wantWrap === 'In line')), after.hint);
				if (label === 'Large') await page.screenshot({ path: `${SHOTS}/mobile-sheet-${size}-${th}-wrapped.png` });
				docs.push(after.doc);
			}
			const top = (await state(page)).scrollTop;
			const undone = [];
			for (let i = docs.length - 2; i >= 0; i--) {
				await page.evaluate(() => app.commands.executeCommandById('editor:undo'));
				await sleep(350);
				const u = await state(page);
				undone.push({ step: i, ok: u.doc === docs[i], scrollTop: u.scrollTop });
			}
			check(`${tag} one undo step per tap, and undo does not scroll`, undone.every((u) => u.ok && u.scrollTop === top), undone);

			// ---- Taps on the sheet itself, and a long press, change nothing ----
			await deselect();
			img = await placePicture(LINK, noteTop(await state(page)) + 120);
			await tapPicture(img);
			const before = await state(page);
			const title = await page.evaluate(() => {
				const r = document.querySelector('.itw-sheet-spacing-title').getBoundingClientRect();
				return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
			});
			await tap(title);
			await t.longPress(centre(before.sheet).x, before.sheet.top + 6, 800);
			await sleep(400);
			s = await state(page);
			check(`${tag} a tap and a long press on the sheet's background change nothing`, s.shown && s.selected && s.doc === before.doc && !s.hasFocus && JSON.stringify(s.cursor) === JSON.stringify(before.cursor) && s.menus === 0 && s.scrollTop === before.scrollTop, {
				shown: s.shown,
				selected: s.selected,
				hasFocus: s.hasFocus,
				menus: s.menus,
			});
			const wrapRight = before.buttons.find((b) => b.text === 'Wrap right');
			await t.longPress(centre(wrapRight.rect).x, centre(wrapRight.rect).y, 800);
			await sleep(400);
			s = await state(page);
			// Whether the release after a long press counts as a tap is the browser's choice; either is fine.
			check(`${tag} a long press on a button opens no menu and keeps the selection`, s.shown && s.selected && s.menus === 0 && !s.hasFocus, { menus: s.menus, line: line(s) });
			if (s.doc !== original) {
				await page.evaluate(() => app.commands.executeCommandById('editor:undo'));
				await sleep(300);
			}

			// ---- Hides: Esc, deselect, switching notes and modes, the setting, a sidebar ----
			const selectAgain = async () => {
				await deselect();
				const r = await placePicture(LINK, noteTop(await state(page)) + 120);
				await tapPicture(r);
				return (await state(page)).shown;
			};
			let was = await selectAgain();
			await page.keyboard.press('Escape');
			await sleep(400);
			s = await state(page);
			check(`${tag} Esc (hardware keyboard) hides the sheet; the picture stays selected`, was && !s.shown && s.selected, { was, shown: s.shown, selected: s.selected });
			was = await selectAgain();
			await tapText();
			s = await state(page);
			check(`${tag} a tap on text deselects the picture and hides the sheet`, was && !s.selected && !s.shown, { was, selected: s.selected, shown: s.shown });
			await page.evaluate(() => app.workspace.activeLeaf.view.editor.cm.contentDOM.blur());
			await sleep(300);

			was = await selectAgain();
			await page.evaluate(() => app.workspace.leftSplit.expand());
			await sleep(900);
			const drawer = await state(page);
			// What a tap on the sheet's left end would hit while the sidebar is open.
			const under = await page.evaluate(() => {
				const r = document.querySelector('.itw-sheet').getBoundingClientRect();
				const hit = document.elementFromPoint(r.left + 20, r.top + r.height / 2);
				return { drawer: !!hit?.closest('.workspace-drawer'), sheet: !!hit?.closest('.itw-sheet') };
			});
			await page.evaluate(() => app.workspace.leftSplit.collapse());
			await sleep(900);
			s = await state(page);
			if (size === 'phone') {
				// A phone's sidebar slides the whole note aside.
				check(`${tag} opening a sidebar hides the sheet; closing it shows the sheet again`, was && !drawer.shown && s.shown && s.selected, { was, inDrawer: drawer.shown, after: s.shown });
			} else {
				// A tablet's sidebar floats over the note, which stays put: the sheet stays under the sidebar.
				check(`${tag} an open sidebar is drawn over the sheet, which takes no taps meanwhile`, was && drawer.shown && under.drawer && !under.sheet && s.shown && s.selected, { was, inDrawer: drawer.shown, under, after: s.shown });
			}

			await page.evaluate(() => app.plugins.plugins['image-text-wrap'].updateSettings({ ...app.plugins.plugins['image-text-wrap'].settings, showToolbar: false }));
			await sleep(400);
			const off = await state(page);
			await page.evaluate(() => app.plugins.plugins['image-text-wrap'].updateSettings({ ...app.plugins.plugins['image-text-wrap'].settings, showToolbar: true }));
			await sleep(500);
			s = await state(page);
			check(`${tag} turning the toolbar setting off hides the sheet; on shows it again`, !off.shown && off.selected && s.shown, { off: off.shown, on: s.shown });

			await h.openNote(page, OTHER, 'live');
			s = await state(page);
			check(`${tag} switching to another note hides the sheet`, !s.shown, { shown: s.shown });
			await h.openNote(page, NOTE, 'live');
			await sleep(300);
			was = await selectAgain();
			await page.evaluate(() => app.commands.executeCommandById('editor:toggle-source'));
			await sleep(500);
			s = await state(page);
			check(`${tag} switching to Source mode hides the sheet`, was && !s.shown, { was, shown: s.shown });
			await page.evaluate(() => app.commands.executeCommandById('editor:toggle-source'));
			await sleep(500);
			was = await selectAgain();
			await page.evaluate(() => app.commands.executeCommandById('markdown:toggle-preview'));
			await sleep(600);
			s = await state(page);
			check(`${tag} switching to Reading view hides the sheet`, was && !s.shown, { was, shown: s.shown });
			await page.evaluate(() => app.commands.executeCommandById('markdown:toggle-preview'));
			await sleep(600);

			// ---- Keeps above the keyboard and Obsidian's editing toolbar (imitated: no keyboard in emulation) ----
			await selectAgain();
			await page.evaluate(() => app.workspace.activeLeaf.view.editor.cm.focus());
			await sleep(400);
			await page.evaluate(() => document.documentElement.style.setProperty('--keyboard-height', '300px'));
			await sleep(700);
			s = await state(page);
			await page.screenshot({ path: `${SHOTS}/mobile-sheet-${size}-${th}-keyboard.png` });
			check(`${tag} (imitated keyboard, 300 px, editor focused) above the keyboard and the editing toolbar`, !s.shown || (placeProblems(s, size).length === 0 && s.sheet.bottom <= s.height - 300 - GAP + 1), {
				shown: s.shown,
				selected: s.selected,
				problems: s.shown ? placeProblems(s, size) : null,
				sheet: s.sheet,
				mobileToolbar: s.mobileToolbar,
			});
			check(`${tag} (imitated keyboard) the sheet stays while the editor has focus and the picture is on screen`, s.shown === s.selected, { shown: s.shown, selected: s.selected, picture: s.picture });
			await page.evaluate(() => {
				document.documentElement.style.removeProperty('--keyboard-height');
				app.workspace.activeLeaf.view.editor.cm.contentDOM.blur();
			});
			await sleep(800);
			was = await selectAgain();
			await page.evaluate(() => {
				Object.defineProperty(window.visualViewport, 'height', { configurable: true, get: () => window.innerHeight - 280 });
				window.visualViewport.dispatchEvent(new Event('resize'));
			});
			await sleep(400);
			const vv = await state(page);
			await page.evaluate(() => {
				delete window.visualViewport.height;
				window.visualViewport.dispatchEvent(new Event('resize'));
			});
			await sleep(400);
			s = await state(page);
			check(`${tag} (imitated visual viewport 280 px shorter, as a keyboard makes it) the sheet moves above it and back`, was && vv.shown && vv.sheet.bottom <= vv.height - 280 - GAP + 1 && s.shown && placeProblems(s, size).length === 0, {
				during: vv.sheet,
				after: s.sheet,
				height: vv.height,
			});

			// ---- A picture the sheet would cover scrolls up once; the user's own scrolling is left alone ----
			// Text above the pictures, so they can sit low on the screen.
			const filler = original.split('\n\n').filter((p) => !p.includes('![[') && !p.startsWith('#')).slice(0, 6).join('\n\n');
			const long = `${filler}\n\n${original}`;
			await h.setNote(page, NOTE, long);
			await sleep(400);
			await deselect();
			s0 = await state(page);
			img = await placePicture(LINK, noteBottom(s0) - 110);
			s0 = await state(page);
			await tapPicture(img);
			await sleep(700);
			s = await state(page);
			check(`${tag} a picture under the sheet scrolls up into view once`, s.shown && s.selected && s.picture.bottom <= s.sheet.top - GAP + 2 && s.picture.top >= noteTop(s0) && s.scrollTop > s0.scrollTop, {
				picture: s.picture,
				sheetTop: s.sheet?.top,
				freeTop: noteTop(s0),
				scrollTop: [s0.scrollTop, s.scrollTop],
			});
			const revealed = s;
			// A slow drag down in the middle of the note. (Starting in the top inset, outside the note, would be
			// Obsidian's pull-down gesture instead.)
			const x = Math.round(s.width / 2);
			const from = Math.round((Math.max(noteTop(s), s.height * 0.15) + s.sheet.top) / 2) - 80;
			const onNote = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('.cm-scroller'), { x, y: from });
			if (!onNote) throw new Error(`the swipe would not start on the note (${x}, ${from})`);
			await t.swipe(x, from, x, from + 160, 16, 24);
			await sleep(700);
			const swiped = await state(page);
			await sleep(1500);
			s = await state(page);
			check(`${tag} scrolling the picture back under the sheet is left alone`, swiped.scrollTop < revealed.scrollTop && s.scrollTop === swiped.scrollTop && s.shown && s.selected && s.picture.bottom > s.sheet.top, {
				revealed: revealed.scrollTop,
				afterSwipe: swiped.scrollTop,
				later: s.scrollTop,
				picture: s.picture,
				sheetTop: s.sheet?.top,
			});
			await tapButton('Wrap right');
			const wrapped = await state(page);
			const landscapeLine = (d) => d.doc.split('\n').find((l) => l.includes('landscape.png'));
			check(`${tag} a layout change after that keeps the view still (no second reveal)`, wrapped.scrollTop === s.scrollTop && landscapeLine(wrapped) === '![[landscape.png|wrap-right|320]]', {
				scrollTop: [s.scrollTop, wrapped.scrollTop],
				line: landscapeLine(wrapped),
			});
			await page.evaluate(() => app.commands.executeCommandById('editor:undo'));
			await sleep(400);

			await deselect();
			s0 = await state(page);
			img = await placePicture(TALL, noteBottom(s0) - 120);
			s0 = await state(page);
			await tapPicture(img);
			await sleep(800);
			s = await state(page);
			// The header was over the note when the picture was tapped (it may slide away as the note scrolls).
			check(`${tag} a picture taller than the free space scrolls up to show its top, not past it`, s.shown && s.selected && Math.abs(s.picture.top - (noteTop(s0) + GAP)) <= 2 && s.scrollTop > s0.scrollTop, {
				pictureTop: s.picture?.top,
				want: noteTop(s0) + GAP,
				scrollTop: [s0.scrollTop, s.scrollTop],
			});
			await deselect();
			s = await state(page);
			check(`${tag} the note is unchanged at the end`, s.doc === long, diffLines(long, s.doc));
		}
	}
	// Turning the plugin off takes the sheet out of the page; turning it on again works as before.
	await page.evaluate(() => app.plugins.disablePlugin('image-text-wrap'));
	await sleep(500);
	const gone = await page.evaluate(() => document.querySelectorAll('.itw-sheet, .itw-toolbar').length);
	await page.evaluate(() => app.plugins.enablePlugin('image-text-wrap'));
	await sleep(800);
	const back = await page.evaluate(() => !!app.plugins.plugins['image-text-wrap']);
	check('turning the plugin off removes the sheet', gone === 0 && back, { left: gone, back });
	check('no console errors', errors.length === 0, errors);
});
