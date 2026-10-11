// M5, phones and tablets: the picture toolbar as a sheet docked at the bottom of the screen.
//   node scripts/obsidian.mjs run tests/e2e/mobile-toolbar-sheet.mjs [phone|tablet] [light|dark] [--fixes-only]
// With no arguments it runs phone and tablet, each in the light and the dark theme, and then, once per size,
// the cases added with the fixes after the M5 review (a double tap, a long press on iPhone and iPad, a phone
// in landscape); --fixes-only runs just those. Obsidian runs in its own mobile emulation (tests/e2e/mobile.mjs),
// and every tap, long press and swipe is real touch input sent over the DevTools protocol. The keyboard cannot
// open in emulation: Obsidian's report of it (--keyboard-height) and a shrinking visual viewport are imitated,
// and labelled so.
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
			safeTop: parseFloat(getComputedStyle(document.body).getPropertyValue('--safe-area-inset-top')) || 0,
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
	const { page } = h;
	const errors = h.watchErrors(page);
	const args = h.args.filter((a) => !a.startsWith('--'));
	const fixesOnly = h.args.includes('--fixes-only');
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
			// The long press recorder (see "A long press on the sheet" below).
			if (window.__itwVibrate) navigator.vibrate = window.__itwVibrate;
			window.__itwBuzz = null;
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
		if (s.sheet.top < noteTop(s) - 1) out.push(`above the top of the screen or over the note's header (${s.sheet.top} < ${noteTop(s)})`);
		if (size === 'phone' && (s.sheet.left > GAP + 1 || s.sheet.right < s.width - GAP - 1)) out.push(`not full width (${s.sheet.left}..${s.sheet.right} of ${s.width})`);
		if (size === 'tablet' && (s.sheet.width > 481 || Math.abs(s.sheet.left - (s.width - s.sheet.right)) > 1)) out.push(`not a centred card (${s.sheet.left}..${s.sheet.right} of ${s.width})`);
		return out;
	}

	/**
	 * How much of the selected picture's area can be seen: on screen, below the note's header (or the status
	 * bar, once the header has slid away) and not under the sheet. 0..1.
	 */
	function uncovered(s) {
		if (!s.picture) return 0;
		const p = s.picture;
		const top = Math.max(p.top, noteTop(s), s.safeTop);
		const bottom = Math.min(p.bottom, s.height);
		const left = Math.max(p.left, 0);
		const right = Math.min(p.right, s.width);
		if (bottom <= top || right <= left) return 0;
		let free = (right - left) * (bottom - top);
		if (s.shown) {
			const ix = Math.max(0, Math.min(right, s.sheet.right) - Math.max(left, s.sheet.left));
			const iy = Math.max(0, Math.min(bottom, s.sheet.bottom) - Math.max(top, s.sheet.top));
			free -= ix * iy;
		}
		return Math.round((free / ((p.right - p.left) * (p.bottom - p.top))) * 100) / 100;
	}

	/** Buttons of the sheet that can be seen (in a short window the spacing segments give way to the hint while in line). */
	const seen = (s) => s.buttons.filter((b) => b.rect.width > 0 && b.rect.height > 0);

	/**
	 * Cases added with the fixes after the M5 review, once per size: a double tap on a picture low on the
	 * screen (M3), a long press on the sheet on iPhone and iPad (M6, M10), and on a phone in landscape the
	 * compact sheet, the reveal, a rotation (M1) and the keyboard (M9).
	 */
	async function fixCases(size) {
		const tag = `${size}:`;
		const filler = original.split('\n\n').filter((p) => !p.includes('![[') && !p.startsWith('#')).slice(0, 6).join('\n\n');
		const long = `${filler}\n\n${original}`;
		await page.keyboard.press('Escape');
		await closeViewer();
		await h.setNote(page, NOTE, long);
		await h.openNote(page, OTHER, 'live');
		await h.openNote(page, NOTE, 'live');
		await sleep(400);

		// ---- A double tap on a picture low on the screen (M3) ----
		// The sheet appears a frame after the first tap, where the picture is, and the reveal used to scroll the
		// picture away at once: the second tap then pressed a sheet button (on a wrapped picture, turning
		// wrapping off) or landed on the text. Now it reaches the picture, as on a picture higher up.
		for (const gap of [120, 200, 300]) {
			await deselect();
			let s0 = await state(page);
			const r = await placePicture(LINK, noteBottom(s0) - 110);
			s0 = await state(page);
			const at = { x: (r.left + r.right) / 2, y: Math.min(r.top + 50, noteBottom(s0) - 20) };
			// Where the (hidden) sheet was last shown on this screen, which is where it will appear.
			const under = await page.evaluate(() => {
				const b = document.querySelector('.itw-sheet').getBoundingClientRect();
				return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
			});
			await t.tap(at.x, at.y);
			await sleep(gap - 60);
			await t.tap(at.x, at.y);
			await sleep(1200);
			const s = await state(page);
			check(`${tag} a double tap (${gap} ms) on a picture low on the screen changes nothing in the note and opens the viewer, as higher up`, s.doc === long && s.lightbox && !s.hasFocus && !s.editableFocused, {
				tapAt: at,
				sheetWillCover: at.y >= under.top && at.x >= under.left && at.x <= under.right,
				diff: diffLines(long, s.doc),
				viewer: s.lightbox,
				hasFocus: s.hasFocus,
				cursor: [s0.cursor, s.cursor],
			});
			await closeViewer();
			if (s.doc !== long) await h.setNote(page, NOTE, long);
		}
		// A single tap there still shows the sheet and reveals the picture (checked in full above); the sheet takes taps once it has settled.
		await deselect();
		let s0 = await state(page);
		let img = await placePicture(LINK, noteBottom(s0) - 110);
		await tapPicture(img);
		await sleep(700);
		let s = await state(page);
		await tapButton('Wrap left');
		const wrapped = await state(page);
		check(`${tag} after a single tap, the sheet is shown, the picture revealed above it, and its buttons work`, s.shown && s.selected && s.picture.bottom <= s.sheet.top && wrapped.doc.includes('![[landscape.png|wrap-left|320]]'), {
			shown: s.shown,
			picture: s.picture,
			sheetTop: s.sheet?.top,
			line: wrapped.doc.split('\n').find((l) => l.includes('landscape.png')),
		});
		await page.evaluate(() => app.commands.executeCommandById('editor:undo'));
		await sleep(400);

		// ---- A long press on the sheet (M6, M10) ----
		// Obsidian's iPhone and iPad app (which its emulation on macOS is) sends an untrusted contextmenu after a
		// 0.8 s hold and buzzes (navigator.vibrate(200)) when a listener cancels it. The sheet only stops that
		// one; the browser's own (trusted, Android) contextmenu is still cancelled.
		await page.evaluate(() => {
			if (!window.__itwVibrate) window.__itwVibrate = navigator.vibrate;
			const rec = (window.__itwBuzz = { vibrate: [], menus: [] });
			navigator.vibrate = (pattern) => {
				window.__itwBuzz?.vibrate.push(pattern);
				return true;
			};
			window.__itwBuzzMenu ??= (e) => window.__itwBuzz?.menus.push(e);
			window.removeEventListener('contextmenu', window.__itwBuzzMenu, true);
			window.addEventListener('contextmenu', window.__itwBuzzMenu, true);
			return !!rec;
		});
		const buzzRead = () =>
			page.evaluate(() => {
				const rec = window.__itwBuzz;
				const out = { vibrate: rec.vibrate.slice(), menus: rec.menus.map((e) => ({ trusted: e.isTrusted, cancelled: e.defaultPrevented })), open: document.querySelectorAll('.menu').length };
				rec.vibrate.length = 0;
				rec.menus.length = 0;
				return out;
			});
		s = await state(page);
		const pressedChoice = s.buttons.find((b) => b.pressed === 'true');
		const offSegment = s.buttons.find((b) => b.text === 'Medium');
		const held = [];
		for (const [what, p] of [
			['the background', { x: centre(s.sheet).x, y: s.sheet.top + 6 }],
			[`the pressed "${pressedChoice.text}" button`, centre(pressedChoice.rect)],
			['the dimmed "Medium" segment', centre(offSegment.rect)],
		]) {
			await t.longPress(p.x, p.y, 1100);
			await sleep(400);
			held.push({ what, ...(await buzzRead()) });
		}
		s = await state(page);
		check(`${tag} a long press on the sheet does not buzz (Obsidian's own contextmenu is left uncancelled) and opens no menu`, held.every((x) => x.vibrate.length === 0 && x.open === 0 && x.menus.every((m) => !m.cancelled)) && s.shown && s.selected, held);
		check(`${tag} (the long press reached Obsidian's iPhone and iPad handler: its contextmenu came)`, held.some((x) => x.menus.some((m) => !m.trusted)), held);
		await page.mouse.click(centre(s.sheet).x, s.sheet.top + 6, { button: 'right' });
		await sleep(400);
		const right = await buzzRead();
		check(`${tag} the browser's own contextmenu on the sheet (Android's long press; here a right-click) is still cancelled, and no menu opens`, right.menus.some((m) => m.trusted && m.cancelled) && right.open === 0, right);
		await page.keyboard.press('Escape');
		await sleep(300);

		if (size !== 'phone') return;

		// ---- A phone in landscape (M1): a compact sheet, and the picture revealed above it ----
		await deselect();
		await h.setWindowSize(page, 844, 390);
		await sleep(900);
		await deselect();
		s0 = await state(page);
		img = await placePicture(LINK, noteTop(s0) + 10);
		await tapPicture(img);
		s = await state(page);
		const inLine = s;
		await tapButton('Wrap left');
		const wrappedLand = await state(page);
		await page.screenshot({ path: `${SHOTS}/mobile-sheet-phone-landscape.png` });
		const compact = (x) =>
			x.shown &&
			x.sheet.height <= 80 &&
			x.sheet.top >= noteTop(x) &&
			x.sheet.bottom <= x.height &&
			seen(x).every((b) => b.rect.width >= 44 && b.rect.height >= 44 && b.labelShown) &&
			seen(x).slice(0, 4).every((b) => b.icon && b.rect.top === seen(x)[0].rect.top);
		check(
			`${tag} landscape: the sheet is one compact row (at most 80 px), every button visible, labelled and at least 44 x 44 px`,
			compact(inLine) && compact(wrappedLand) && seen(wrappedLand).length === 8 && placeProblems(wrappedLand, 'phone').length === 0,
			{ sheet: [inLine.sheet, wrappedLand.sheet], buttons: seen(wrappedLand).map((b) => [b.text, b.rect]), problems: wrappedLand.shown ? placeProblems(wrappedLand, 'phone') : null },
		);
		check(
			`${tag} landscape: while in line, "Choose a wrap option first" shows in place of the spacing segments; once wrapped, the segments`,
			inLine.hint?.visible && seen(inLine).length === 4 && !wrappedLand.hint?.visible && seen(wrappedLand).slice(4).map((b) => b.text).join() === SEGMENTS.join() && pressed(wrappedLand).join() === 'Wrap left,Medium',
			{ inLine: { hint: inLine.hint, seen: seen(inLine).map((b) => b.text) }, wrapped: { hint: wrappedLand.hint, seen: seen(wrappedLand).map((b) => b.text), pressed: pressed(wrappedLand) } },
		);
		await page.evaluate(() => app.commands.executeCommandById('editor:undo'));
		await sleep(400);

		// The header is shown when the picture is tapped (a press brings it back); the reveal scrolls it away.
		await deselect();
		s0 = await state(page);
		img = await placePicture(LINK, Math.round(s0.height * 0.55));
		s0 = await state(page);
		await tapPicture(img);
		await sleep(1200);
		s = await state(page);
		check(`${tag} landscape: a picture tapped low on the screen is revealed with at least 70% of it in view above the sheet`, s.shown && s.selected && uncovered(s) >= 0.7 && s.scrollTop > s0.scrollTop, {
			uncovered: uncovered(s),
			picture: s.picture,
			sheet: s.sheet,
			header: [s0.header, s.header],
			scrollTop: [s0.scrollTop, s.scrollTop],
		});
		await page.screenshot({ path: `${SHOTS}/mobile-sheet-phone-landscape-revealed.png` });

		// Turning the phone with the sheet up: the picture is revealed again (a keyboard does not do that).
		await deselect();
		await h.setWindowSize(page, 390, 844);
		await sleep(900);
		await deselect();
		s0 = await state(page);
		img = await placePicture(LINK, noteTop(s0) + 200);
		await tapPicture(img);
		const upright = await state(page);
		await h.setWindowSize(page, 844, 390);
		await sleep(1500);
		s = await state(page);
		check(`${tag} turning the phone to landscape with the sheet up reveals the picture again: at least 70% in view`, upright.shown && upright.picture.bottom <= upright.sheet.top && s.shown && s.selected && uncovered(s) >= 0.7, {
			upright: { picture: upright.picture, sheet: upright.sheet },
			uncovered: uncovered(s),
			picture: s.picture,
			sheet: s.sheet,
		});

		// ---- A phone in landscape with the keyboard up (M9, imitated as above) ----
		await deselect();
		s0 = await state(page);
		img = await placePicture(LINK, noteTop(s0) + 10);
		await tapPicture(img);
		await page.evaluate(() => app.workspace.activeLeaf.view.editor.cm.focus());
		await sleep(500);
		const typed = [];
		for (const kb of [120, 160, 200, 250]) {
			await page.evaluate((kb) => document.documentElement.style.setProperty('--keyboard-height', `${kb}px`), kb);
			await sleep(700);
			const k = await state(page);
			typed.push({ kb, selected: k.selected, shown: k.shown, sheet: k.sheet, header: k.header, toolbar: k.mobileToolbar, problems: k.shown ? placeProblems(k, 'phone') : [], noteLeft: k.shown ? k.sheet.top - noteTop(k) : null });
			if (kb === 200) await page.screenshot({ path: `${SHOTS}/mobile-sheet-phone-landscape-keyboard-200.png` });
		}
		// An iPhone has no top inset in landscape (the emulation keeps the portrait one): its header is lower,
		// and a small keyboard leaves room for the compact sheet.
		await page.evaluate(() => document.body.style.setProperty('--safe-area-inset-top', '0px'));
		await page.evaluate(() => document.documentElement.style.setProperty('--keyboard-height', '120px'));
		await sleep(800);
		const room = await state(page);
		await page.evaluate(() => document.body.style.removeProperty('--safe-area-inset-top'));
		await page.evaluate(() => document.documentElement.style.removeProperty('--keyboard-height'));
		await sleep(800);
		const back = await state(page);
		check(`${tag} landscape, imitated keyboard (120 to 250 px): the sheet never leaves the screen or covers the header, and leaves some of the note in view, or else waits`, typed.every((k) => k.selected && (!k.shown || (k.problems.length === 0 && k.noteLeft >= 44))), typed);
		check(`${tag} landscape, no top inset, imitated keyboard 120 px: the compact sheet fits between the header and the editing toolbar`, room.shown && room.selected && placeProblems(room, 'phone').length === 0 && room.sheet.height <= 80 && room.sheet.top - noteTop(room) >= 44, {
			shown: room.shown,
			sheet: room.sheet,
			header: room.header,
			toolbar: room.mobileToolbar,
			problems: room.shown ? placeProblems(room, 'phone') : null,
		});
		check(`${tag} landscape: once the keyboard goes, the sheet is back`, back.shown && back.selected && placeProblems(back, 'phone').length === 0, { shown: back.shown, selected: back.selected, problems: back.shown ? placeProblems(back, 'phone') : null });
		await page.evaluate(() => app.workspace.activeLeaf.view.editor.cm.contentDOM.blur());
		await sleep(300);
		await deselect();
		await h.setWindowSize(page, 390, 844);
		await sleep(600);
	}

	for (const size of sizes) {
		await setMobile(page, true, size);
		for (const th of fixesOnly ? [] : themes) {
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
			// The header was over the note when the picture was tapped. On a phone with auto full screen (Obsidian's
			// default) the reveal's scroll slides it away, and the picture's top goes up to the status bar instead.
			const headerGoes = s0.body.split(' ').includes('is-phone') && s0.body.split(' ').includes('auto-full-screen');
			const freeTop = headerGoes ? Math.max(s0.safeTop, 0) : noteTop(s0);
			check(`${tag} a picture taller than the free space scrolls up to show its top, not past it`, s.shown && s.selected && Math.abs(s.picture.top - (freeTop + GAP)) <= 2 && s.scrollTop > s0.scrollTop, {
				pictureTop: s.picture?.top,
				want: freeTop + GAP,
				headerGoes,
				header: s.header,
				scrollTop: [s0.scrollTop, s.scrollTop],
			});
			await deselect();
			s = await state(page);
			check(`${tag} the note is unchanged at the end`, s.doc === long, diffLines(long, s.doc));
		}
		await fixCases(size);
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
