// M5, phones and tablets: the picture toolbar as a sheet docked at the bottom of the screen.
//   node scripts/obsidian.mjs run tests/e2e/mobile-toolbar-sheet.mjs [phone|tablet] [light|dark]
//     [--fixes-only | --review-only] [--case=straddle,reveal-tap,rotate,landscape-keyboard,tablet-keyboard,pinned,narrow]
// With no arguments it runs phone and tablet, each in the light and the dark theme, and then, once per size,
// the cases added with the fixes after the M5 review (a double tap, a long press on iPhone and iPad, a phone
// in landscape) and after the second review (reviewCases: a slow double tap, a tap during the reveal, a
// rotation, the keyboard in landscape and on a tablet, a pinned sidebar, a narrow phone in landscape);
// --fixes-only runs just those, --review-only just the second ones (--case picks some of them). Obsidian runs
// in its own mobile emulation (tests/e2e/mobile.mjs), and every tap, long press and swipe is real touch input
// sent over the DevTools protocol. The keyboard cannot open in emulation: Obsidian's report of it
// (--keyboard-height) and a shrinking visual viewport are imitated, and labelled so.
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

/**
 * Runs the probe below and makes sure the window leaves mobile emulation whatever happens: the probe's own
 * restore steps do that, this puts it right if one of them failed, and an interrupted run (Ctrl-C, a
 * timeout's SIGTERM) turns emulation off before it exits. Emulation is stored in the profile, so a window
 * left in it would come back as a phone at the next launch.
 */
export default async function run(h) {
	const leave = async () => {
		const still = await h.page.evaluate(() => window.app?.isMobile).catch(() => null);
		if (still) await setMobile(h.page, false);
	};
	const interrupted = async (signal) => {
		await h.page
			.evaluate(() => {
				window.electronWindow?.setContentSize(1280, 900);
				if (app.isMobile) app.emulateMobile(false);
			})
			.catch(() => {});
		process.exit(signal === 'SIGTERM' ? 143 : 130);
	};
	process.once('SIGINT', interrupted);
	process.once('SIGTERM', interrupted);
	try {
		return await sheetProbe(h);
	} finally {
		process.off('SIGINT', interrupted);
		process.off('SIGTERM', interrupted);
		await leave().catch(() => {});
	}
}

const sheetProbe = probe(async (h, check, restore) => {
	const { page } = h;
	const errors = h.watchErrors(page);
	const args = h.args.filter((a) => !a.startsWith('--'));
	const reviewOnly = h.args.includes('--review-only');
	const fixesOnly = reviewOnly || h.args.includes('--fixes-only');
	const picked = h.args.find((a) => a.startsWith('--case='))?.slice(7).split(',') ?? null;
	/** Whether a case of reviewCases runs (--case=name,... picks some). */
	const runs = (name) => !picked || picked.includes(name);
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
			document.body.style.removeProperty('--safe-area-inset-top');
			delete window.visualViewport.height;
			for (const split of [app.workspace.leftSplit, app.workspace.rightSplit]) {
				split.setPinned?.(false);
				split.collapse();
			}
			// The long press recorder (see "A long press on the sheet" below).
			if (window.__itwVibrate) navigator.vibrate = window.__itwVibrate;
			window.__itwBuzz = null;
			// The double tap timer (see "A double tap on a picture low on the screen" below).
			if (window.__itwPress) window.removeEventListener('touchstart', window.__itwPress, true);
			// The event log of reviewCases (startLog below).
			if (window.__itwLogOn) for (const type of ['pointerdown', 'pointerup', 'click']) window.removeEventListener(type, window.__itwLogOn, true);
			window.__itwLogSheet?.disconnect();
			window.__itwLog = window.__itwLogOn = window.__itwLogSheet = window.__itwLogEl = null;
		}),
	);

	const t = touch(page);
	const tap = async (p, ms = 450) => {
		await t.tap(p.x, p.y);
		await sleep(ms);
	};

	/**
	 * Closes Obsidian's image viewer with a tap on its close button, if a step opened it. On a phone or tablet
	 * the button sits on the viewer itself (.modal-close-button, top right); on a desktop it is in the
	 * viewer's title bar. Throws if the viewer stays open, since it covers the whole window.
	 */
	async function closeViewer() {
		const target = () =>
			page.evaluate(() => {
				const box = document.querySelector('.lightbox');
				if (!box) return null;
				const close = box.querySelector('.modal-close-button') ?? [...box.querySelectorAll('.lightbox-titlebar .clickable-icon, .lightbox-titlebar button')].pop();
				if (!close) return { x: 0, y: 0, button: false };
				const r = close.getBoundingClientRect();
				return { x: r.left + r.width / 2, y: r.top + r.height / 2, button: true };
			});
		for (let i = 0; i < 4; i++) {
			const p = await target();
			if (!p) return;
			if (p.button) await tap(p, 500);
			else {
				await page.keyboard.press('Escape');
				await sleep(500);
			}
		}
		if (await target()) throw new Error("Obsidian's image viewer did not close");
	}

	/** The first line of the note that is long plain text (no picture, not a heading), 1-based. */
	const plainLine = (doc) => doc.split('\n').findIndex((l) => l.length >= 40 && !l.includes('![[') && !l.startsWith('#')) + 1;

	/**
	 * Where a tap lands on plain text in the note: on a line of text (no picture), inside the free band below
	 * the header and above the sheet, the navigation bar and Obsidian's editing toolbar, at a point that
	 * really hits that line (nothing drawn over it). Null if no such text is on screen.
	 */
	async function textPoint() {
		const s = await state(page);
		if (s.lightbox) return null;
		return page.evaluate(
			({ top, bottom }) => {
				const cm = app.workspace.activeLeaf.view.editor.cm;
				for (const l of cm.contentDOM.querySelectorAll('.cm-line')) {
					if (l.querySelector('.image-embed, .cm-embed-block, .internal-link, .external-link, .tag') || l.textContent.trim().length < 20) continue;
					const r = l.getBoundingClientRect();
					const from = Math.max(r.top, top + 10);
					const to = Math.min(r.bottom, bottom - 10);
					if (to - from < 12) continue;
					for (const y of [from + 8, (from + to) / 2, to - 6]) {
						for (const x of [r.left + 30, (r.left + r.right) / 2]) {
							const hit = document.elementFromPoint(x, y);
							if (hit && hit.closest('.cm-line') === l && !hit.closest('.image-embed, .cm-embed-block, a, .cm-widgetBuffer')) return { x: Math.round(x), y: Math.round(y) };
						}
					}
				}
				return null;
			},
			{ top: noteTop(s), bottom: noteBottom(s) },
		);
	}

	/**
	 * Taps plain text in the note, clear of the bars and the sheet (this deselects any image). If none is on
	 * screen (the note is scrolled to pictures, or a viewer is open), closes the viewer and scrolls the first
	 * plain line of the note into the middle of the screen first.
	 */
	async function tapText() {
		let p = await waitFor(textPoint, 1500);
		if (!p) {
			await closeViewer();
			const n = plainLine((await state(page)).doc);
			if (n > 0) {
				await page.evaluate((n) => {
					const cm = app.workspace.activeLeaf.view.editor.cm;
					cm.dispatch({ effects: cm.constructor.scrollIntoView(cm.state.doc.line(n).from, { y: 'center' }) });
				}, n);
				await sleep(400);
			}
			p = await waitFor(textPoint, 3000);
		}
		if (!p) {
			const s = await state(page);
			throw new Error(`no plain text on screen to tap (${JSON.stringify({ viewer: s.lightbox, band: [noteTop(s), noteBottom(s)], sheet: s.shown ? s.sheet : null, navbar: s.navbar, toolbar: s.mobileToolbar, scrollTop: s.scrollTop })})`);
		}
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

	/**
	 * Puts the cursor on the text just below LINK's picture with a tap there, and leaves the editor without
	 * focus. Focusing the editor afterwards (as the keyboard opening would) then leaves the note where it is;
	 * with the cursor far away it scrolls there, the picture leaves the screen and CodeMirror drops it, and
	 * with it the selection.
	 */
	async function cursorBelowPicture() {
		await page.evaluate((needle) => {
			const cm = app.workspace.activeLeaf.view.editor.cm;
			const line = cm.state.doc.lineAt(cm.state.doc.toString().indexOf(needle));
			cm.dispatch({ effects: cm.constructor.scrollIntoView(line.to + 1, { y: 'center' }) });
		}, LINK);
		await sleep(400);
		const s = await state(page);
		const find = () =>
			page.evaluate(
				({ needle, top, bottom }) => {
					const cm = app.workspace.activeLeaf.view.editor.cm;
					const pos = cm.state.doc.lineAt(cm.state.doc.toString().indexOf(needle)).to + 1;
					const c = cm.coordsAtPos(pos);
					if (!c) return null;
					const x = Math.round(c.left + 24);
					const y = Math.round((c.top + c.bottom) / 2);
					if (y < top + 10 || y > bottom - 10) return null;
					const hit = document.elementFromPoint(x, y);
					const l = hit?.closest('.cm-line');
					return l && !hit.closest('.image-embed') && cm.posAtDOM(l) === pos ? { x, y } : null;
				},
				{ needle: LINK, top: noteTop(s), bottom: noteBottom(s) },
			);
		const p = await waitFor(find, 2000);
		if (!p) throw new Error('the text below the picture is not on screen to tap');
		await tap(p);
		await page.evaluate(() => app.workspace.activeLeaf.view.editor.cm.contentDOM.blur());
		await sleep(400);
	}

	/**
	 * Selects LINK's picture with a tap, its top placed `at(state)` px down the window, with the editor
	 * without focus, and returns the state then. `cursorNear`: the cursor goes on the text below the picture
	 * first (cursorBelowPicture), for a step that then focuses the editor.
	 */
	async function selectPicture(at, cursorNear = false) {
		if (cursorNear) {
			await closeViewer();
			await cursorBelowPicture();
		} else await deselect();
		const r = await placePicture(LINK, at(await state(page)));
		await tapPicture(r);
		return state(page);
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

	/** Whether the sheet is in its compact form (one row, about 70 to 90 px tall instead of about 170). */
	const compactSheet = (s) => s.shown && s.sheet.height <= 100;

	/**
	 * The sheet's place: above the bars and keyboard, inside the safe area, full width or (the full sheet on a
	 * tablet) a centred card. Across the note's pane: `pane` is its left and right edge (the whole window when
	 * not given).
	 */
	function placeProblems(s, size, pane = { left: 0, right: s.width }) {
		const out = [];
		if (!s.shown) return ['not shown'];
		if (s.sheet.bottom > s.height - s.safeBottom - GAP + 1) out.push(`below the safe area (${s.sheet.bottom} > ${s.height - s.safeBottom - GAP})`);
		if (s.navbar && s.sheet.bottom > s.navbar.top - GAP + 1) out.push(`covers the navigation bar (${s.sheet.bottom} > ${s.navbar.top})`);
		if (s.mobileToolbar && s.sheet.bottom > s.mobileToolbar.top - GAP + 1) out.push(`covers the editing toolbar (${s.sheet.bottom} > ${s.mobileToolbar.top})`);
		if (s.sheet.left < 0 || s.sheet.right > s.width) out.push('off screen');
		if (s.sheet.top < noteTop(s) - 1) out.push(`above the top of the screen or over the note's header (${s.sheet.top} < ${noteTop(s)})`);
		const card = size === 'tablet' && !compactSheet(s);
		if (!card && (s.sheet.left > pane.left + GAP + 1 || s.sheet.right < pane.right - GAP - 1)) out.push(`not full width (${s.sheet.left}..${s.sheet.right} of ${pane.left}..${pane.right})`);
		if (s.sheet.left < pane.left || s.sheet.right > pane.right) out.push(`outside the note's pane (${s.sheet.left}..${s.sheet.right} of ${pane.left}..${pane.right})`);
		if (card && (s.sheet.width > 481 || s.sheet.left < pane.left + GAP - 1 || s.sheet.right > pane.right - GAP + 1 || Math.abs(s.sheet.left - pane.left - (pane.right - s.sheet.right)) > 1)) out.push(`not a centred card (${s.sheet.left}..${s.sheet.right} of ${pane.left}..${pane.right})`);
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
			// The time between the two presses as the page sees it (touchstart to touchstart). On a busy machine
			// it can come out well over the gap asked for, and past the double tap window (DOUBLE_TAP_WAIT, 350 ms
			// from the sheet appearing) the second tap is a tap of its own: such a try is made again, up to three times.
			let s;
			let s0;
			let at;
			let under;
			let seenGap = null;
			const tries = [];
			for (let i = 0; i < 3; i++) {
				await deselect();
				s0 = await state(page);
				const r = await placePicture(LINK, noteBottom(s0) - 110);
				s0 = await state(page);
				at = { x: (r.left + r.right) / 2, y: Math.min(r.top + 50, noteBottom(s0) - 20) };
				// Where the (hidden) sheet was last shown on this screen, which is where it will appear.
				under = await page.evaluate(() => {
					const b = document.querySelector('.itw-sheet').getBoundingClientRect();
					return { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
				});
				await page.evaluate(() => {
					window.__itwPresses = [];
					window.__itwPress ??= (e) => window.__itwPresses?.push(e.timeStamp);
					window.removeEventListener('touchstart', window.__itwPress, true);
					window.addEventListener('touchstart', window.__itwPress, true);
				});
				await t.tap(at.x, at.y);
				await sleep(gap - 60);
				await t.tap(at.x, at.y);
				await sleep(1200);
				s = await state(page);
				const presses = await page.evaluate(() => window.__itwPresses);
				seenGap = presses.length === 2 ? Math.round(presses[1] - presses[0]) : null;
				tries.push(seenGap);
				if (seenGap !== null && seenGap <= gap + 40) break;
				await closeViewer();
				if (s.doc !== long) await h.setNote(page, NOTE, long);
			}
			check(`${tag} a double tap (${gap} ms) on a picture low on the screen changes nothing in the note and opens the viewer, as higher up`, s.doc === long && s.lightbox && !s.hasFocus && !s.editableFocused, {
				tapAt: at,
				gapsSeen: tries,
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
		// Undo leaves the picture deselected and the sheet hidden: select it again, clear of the sheet.
		s = await selectPicture((x) => noteTop(x) + 120);
		await buzzRead();
		check(`${tag} (setup) the picture is selected and the sheet up before the long presses`, s.shown && s.selected, { shown: s.shown, selected: s.selected });
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
		check(`${tag} a long press on the sheet does not buzz (Obsidian's own contextmenu is left uncancelled) and opens no menu`, held.every((x) => x.vibrate.length === 0 && x.open === 0 && x.menus.every((m) => !m.cancelled)) && s.shown && s.selected, {
			held,
			after: { shown: s.shown, selected: s.selected, link: s.doc.split('\n').find((l) => l.includes('landscape.png')) },
		});
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
			scrollTop: [upright.scrollTop, s.scrollTop],
		});

		// ---- A phone in landscape with the keyboard up (M9, imitated as above) ----
		// The cursor goes beside the picture first, so focusing the editor leaves the picture on screen.
		s0 = await selectPicture((x) => noteTop(x) + 10, true);
		await page.evaluate(() => app.workspace.activeLeaf.view.editor.cm.focus());
		await sleep(500);
		s = await state(page);
		check(`${tag} landscape (setup) the picture is selected while the editor has focus, as with the keyboard up`, s0.selected && s.selected && s.hasFocus, {
			selected: [s0.selected, s.selected],
			hasFocus: s.hasFocus,
			cursor: s.cursor,
			scrollTop: [s0.scrollTop, s.scrollTop],
		});
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

	/**
	 * Touch input at set times (ms from the start), sent without waiting for one another: awaiting each event
	 * adds about 40 ms, too much for the timing of a double tap. Steps: [ms, 'down' | 'up', x, y].
	 */
	async function timed(steps) {
		const start = Date.now();
		await Promise.all(
			steps.map(
				([ms, kind, x, y]) =>
					new Promise((done) => {
						setTimeout(() => (kind === 'down' ? t.down(x, y) : t.up()).then(done, done), Math.max(0, ms - (Date.now() - start)));
					}),
			),
		);
	}

	/**
	 * Starts a log in the page of every press, lift and click (page time, what it reached, the note's scroll
	 * position then) and of the moment the sheet appears; readLog returns it.
	 */
	const startLog = () =>
		page.evaluate(() => {
			const sheet = document.querySelector('.itw-sheet');
			window.__itwLog = { ev: [], shown: null };
			if (!window.__itwLogOn) {
				window.__itwLogOn = (e) => {
					const cm = app.workspace.activeLeaf?.view?.editor?.cm;
					const button = e.target.closest?.('button');
					const where = e.target.closest?.('.itw-sheet') ? `sheet ${button?.textContent ?? ''}`.trim() : e.target.tagName;
					window.__itwLog?.ev.push({ type: e.type, t: e.timeStamp, where, scrollTop: cm?.scrollDOM.scrollTop ?? null });
				};
				for (const type of ['pointerdown', 'pointerup', 'click']) window.addEventListener(type, window.__itwLogOn, true);
			}
			if (window.__itwLogEl !== sheet) {
				window.__itwLogSheet?.disconnect();
				window.__itwLogEl = sheet;
				window.__itwLogSheet = new MutationObserver(() => {
					const log = window.__itwLog;
					if (log && log.shown === null && !sheet.classList.contains('itw-sheet-hidden')) log.shown = performance.now();
				});
				window.__itwLogSheet.observe(sheet, { attributes: true, attributeFilter: ['class'] });
			}
			return true;
		});
	const readLog = () => page.evaluate(() => window.__itwLog);

	/**
	 * Puts the open note's text back to `text`: in the editor, whose own save of a change made a moment ago
	 * would otherwise write over a change made on disk, and then on disk.
	 */
	async function resetNote(text) {
		await page.evaluate(async (text) => {
			const view = app.workspace.activeLeaf.view;
			if (view.editor.getValue() !== text) view.editor.setValue(text);
			await view.save();
		}, text);
		await sleep(300);
	}

	/** The note's scroller, left to right, and whether each sheet button takes a tap at its centre (nothing drawn over it). */
	const reach = () =>
		page.evaluate(() => {
			const cm = app.workspace.activeLeaf.view.editor.cm;
			const r = cm.scrollDOM.getBoundingClientRect();
			return {
				pane: { left: Math.round(r.left), right: Math.round(r.right) },
				buttons: [...document.querySelectorAll('.itw-sheet button')]
					.filter((b) => b.getBoundingClientRect().width > 0)
					.map((b) => {
						const c = b.getBoundingClientRect();
						const hit = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
						return { text: b.textContent, takesTap: hit?.closest('button') === b, hit: hit && !b.contains(hit) ? `${hit.tagName}.${String(hit.className).split(' ')[0]}` : null };
					}),
			};
		});

	/** Whether the text of every sheet button stays inside the button (none spills onto its neighbours). */
	const spills = () =>
		page.evaluate(() =>
			[...document.querySelectorAll('.itw-sheet button')]
				.filter((b) => b.getBoundingClientRect().width > 0)
				.map((b) => {
					const label = b.querySelector('.itw-sheet-choice-label') ?? b;
					const range = document.createRange();
					range.selectNodeContents(label);
					const text = range.getBoundingClientRect();
					const box = b.getBoundingClientRect();
					return { text: b.textContent, button: [box.left, box.right].map((v) => Math.round(v * 10) / 10), label: [text.left, text.right].map((v) => Math.round(v * 10) / 10), spills: text.left < box.left - 0.5 || text.right > box.right + 0.5 };
				}),
		);

	/**
	 * Cases added with the fixes after the second review, once per size: a slow double tap (N5, N8) and a
	 * layout chosen while the reveal is scrolling (N6); on a phone a rotation (N1, N4), a small keyboard in
	 * landscape (N2) and a narrow phone in landscape (N7); on a tablet the keyboard (N3) and a pinned sidebar (N9).
	 */
	async function reviewCases(size) {
		const tag = `${size}:`;
		const filler = original.split('\n\n').filter((p) => !p.includes('![[') && !p.startsWith('#')).slice(0, 6).join('\n\n');
		const long = `${filler}\n\n${original}`;
		await page.keyboard.press('Escape');
		await closeViewer();
		await h.setNote(page, NOTE, long);
		await h.openNote(page, OTHER, 'live');
		await h.openNote(page, NOTE, 'live');
		await sleep(400);
		// Where each sheet button is while the sheet is shown: the sheet stays put whatever the note does.
		let s = await selectPicture((x) => noteTop(x) + 40);
		if (!s.shown) throw new Error('the sheet did not show to be measured');
		const buttonAt = Object.fromEntries(s.buttons.map((b) => [b.text, centre(b.rect)]));

		if (runs('straddle')) {
			// ---- A slow double tap (N5, N8) ----
			// The second press starts while the sheet the first tap brought up still lets taps through
			// (DOUBLE_TAP_WAIT, 350 ms from its appearing) and lifts after that. Its click belongs to the picture
			// where the press began, not to the button that is under the finger by then ("Wrap left", pressed, on
			// a wrapped picture: it would turn wrapping off). The note stays as it was and Obsidian's viewer opens,
			// as for a quick double tap.
			const W = '![[landscape.png|wrap-left|320]]';
			const longW = long.replace(LINK, W);
			await resetNote(longW);
			await sleep(400);
			const at = buttonAt['Wrap left'];
			for (const hold of [200, 400]) {
				let second = 280; // ms from the first press to the second
				const tries = [];
				let s1 = null;
				for (let i = 0; i < 3; i++) {
					await deselect();
					const r = await placePicture(W, at.y - 60);
					const onPicture = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.tagName === 'IMG', at);
					await startLog();
					await timed([
						[0, 'down', at.x, at.y],
						[60, 'up'],
						[second, 'down', at.x, at.y],
						[second + hold, 'up'],
					]);
					await sleep(1300);
					s1 = await state(page);
					const log = await readLog();
					const downs = log.ev.filter((e) => e.type === 'pointerdown');
					const ups = log.ev.filter((e) => e.type === 'pointerup');
					const clicks = log.ev.filter((e) => e.type === 'click');
					const rel = (e) => (e && log.shown !== null ? Math.round(e.t - log.shown) : null);
					const row = {
						second,
						onPicture,
						picture: [Math.round(r.top), Math.round(r.bottom)],
						shownAfterFirstPress: downs[0] && log.shown !== null ? Math.round(log.shown - downs[0].t) : null,
						down2: rel(downs[1]),
						up2: rel(ups[1]),
						click2: clicks[1] ? `${rel(clicks[1])} ${clicks[1].where}` : null,
						changed: diffLines(longW, s1.doc),
						viewer: s1.lightbox,
					};
					row.straddled = row.down2 !== null && row.down2 < 340 && row.up2 !== null && row.up2 > 370;
					tries.push(row);
					if ((row.straddled && onPicture) || !onPicture) break;
					// Aim the second press 200 ms after the sheet appeared.
					if (row.shownAfterFirstPress !== null) second = row.shownAfterFirstPress + 200;
					await closeViewer();
					if (s1.doc !== longW) await resetNote(longW);
				}
				const last = tries[tries.length - 1];
				check(
					`${tag} a slow double tap (the second press held ${hold} ms, from while the sheet lets taps through to after) on a wrapped picture under the sheet changes nothing and opens the viewer`,
					last.onPicture && last.straddled && s1.doc === longW && s1.lightbox,
					tries,
				);
				await closeViewer();
				if (s1.doc !== longW) await resetNote(longW);
			}
			// Once it has settled, the sheet takes a tap as before.
			await deselect();
			const r = await placePicture(W, noteTop(await state(page)) + 40);
			await tapPicture(r);
			await sleep(400);
			await tapButton('Wrap right');
			s = await state(page);
			check(`${tag} after the slow double taps, a tap on the settled sheet still works`, s.shown && s.doc.includes('![[landscape.png|wrap-right|320]]'), { shown: s.shown, line: s.doc.split('\n').find((l) => l.includes('landscape.png')) });
			await resetNote(long);
			await sleep(400);
		}

		if (runs('reveal-tap')) {
			// ---- A layout chosen while the reveal is still scrolling (N6) ----
			// A single tap on a picture low on the screen, then "Top and bottom" while the note scrolls the picture
			// clear of the sheet. The write holds the view while the new layout settles: it must hold the revealed
			// one, not the one halfway, or the next update of the editor (made here soon after, as Obsidian makes
			// one now and then) scrolls the note back and leaves the picture under the sheet.
			let at = 470; // ms from the tap on the picture to the press on the button
			const tries = [];
			let s1 = null;
			const b = buttonAt['Top and bottom'];
			for (let i = 0; i < 4; i++) {
				await deselect();
				let s0 = await state(page);
				const r = await placePicture(LINK, noteBottom(s0) - 110);
				s0 = await state(page);
				const p = { x: Math.round((r.left + r.right) / 2), y: Math.round(Math.max(r.top, noteTop(s0)) + 20) };
				await startLog();
				await page.evaluate(() => {
					const cm = app.workspace.activeLeaf.view.editor.cm;
					const log = window.__itwLog;
					log.scrolls = [];
					cm.scrollDOM.scrollBy = function (...a) {
						log.scrolls.push({ t: performance.now(), from: this.scrollTop, options: a[0] });
						return Element.prototype.scrollBy.apply(this, a);
					};
					window.__itwPoke = (e) => {
						if (e.target.closest?.('.itw-sheet')) setTimeout(() => cm.dispatch({}), 150);
					};
					window.addEventListener('click', window.__itwPoke, true);
				});
				await timed([
					[0, 'down', p.x, p.y],
					[60, 'up'],
					[at, 'down', b.x, b.y],
					[at + 60, 'up'],
				]);
				await sleep(1500);
				s1 = await state(page);
				const log = await page.evaluate(() => {
					delete app.workspace.activeLeaf.view.editor.cm.scrollDOM.scrollBy;
					window.removeEventListener('click', window.__itwPoke, true);
					return window.__itwLog;
				});
				const t0 = log.ev[0]?.t ?? 0;
				const reveal = log.scrolls[0] ?? null;
				const click = log.ev.find((e) => e.type === 'click' && e.where.startsWith('sheet')) ?? null;
				const target = reveal ? reveal.from + reveal.options.top : null;
				const row = {
					at,
					reveal: reveal && { t: Math.round(reveal.t - t0), from: reveal.from, by: reveal.options.top, behavior: reveal.options.behavior },
					click: click && { t: Math.round(click.t - t0), where: click.where, scrollTop: click.scrollTop },
					end: s1.scrollTop,
					target,
					line: s1.doc.split('\n').find((l) => l.includes('landscape.png')),
					picture: s1.picture,
					sheetTop: s1.shown ? s1.sheet.top : null,
					uncovered: uncovered(s1),
				};
				row.midway = !!reveal && !!click && click.scrollTop > reveal.from + 2 && click.scrollTop < target - 2;
				tries.push(row);
				if (row.midway) break;
				// Aim the press at the middle of the reveal's scroll (about 200 ms long). A press too early reaches
				// the note through the sheet, which still lets taps through.
				if (!click) at += 60;
				else if (reveal) at += click.t < reveal.t ? Math.round(reveal.t - click.t) + 60 : -80;
				await resetNote(long);
				await sleep(300);
			}
			const last = tries[tries.length - 1];
			check(
				`${tag} a layout chosen while the reveal is still scrolling is applied, and the reveal is not undone: the picture ends clear of the sheet`,
				last.midway && last.line === '![[landscape.png|wrap-block|320]]' && Math.abs(last.end - last.target) <= 2 && s1.shown && s1.selected && last.picture.bottom <= last.sheetTop,
				tries,
			);
			await resetNote(long);
			await sleep(300);
		}

		if (size === 'phone' && runs('rotate')) {
			// ---- Turning the phone with the sheet up (N1, N4) ----
			// The first look after a rotation sees the text re-wrapped at the old scroll position, which CodeMirror
			// puts right a moment later. Whatever that first look says, the picture is revealed again once things
			// have settled: at least 70% of it in view above the compact sheet.
			const rows = [];
			for (const [what, at] of [
				['its top 200 px below the header', (x) => noteTop(x) + 200],
				['its top 296 px below the header (revealed upright first)', (x) => noteTop(x) + 296],
				['revealed upright from low on the screen', (x) => noteBottom(x) - 110],
			]) {
				await deselect();
				const r = await placePicture(LINK, at(await state(page)));
				await tapPicture(r);
				await sleep(900);
				const upright = await state(page);
				await h.setWindowSize(page, 844, 390);
				await sleep(1500);
				const s1 = await state(page);
				rows.push({
					what,
					upright: { shown: upright.shown, picture: upright.picture, sheet: upright.sheet },
					landscape: { shown: s1.shown, selected: s1.selected, picture: s1.picture, sheet: s1.sheet, uncovered: uncovered(s1), scrollTop: [upright.scrollTop, s1.scrollTop] },
				});
				await deselect();
				await h.setWindowSize(page, 390, 844);
				await sleep(900);
			}
			check(
				`${tag} turning the phone to landscape with the sheet up reveals the picture again, wherever it was: at least 70% in view`,
				rows.every((x) => x.upright.shown && x.upright.picture.bottom <= x.upright.sheet.top && x.landscape.shown && x.landscape.selected && x.landscape.uncovered >= 0.7),
				rows,
			);
		}

		if (size === 'phone' && runs('landscape-keyboard')) {
			// ---- A phone in landscape, no top inset, a small keyboard (N2), imitated ----
			// An iPhone has no top inset in landscape (the emulation keeps the portrait one), so its header rests
			// higher. A small keyboard (or a hardware keyboard's bar) leaves room for the compact sheet and a strip of
			// the note (44 px at least); a 200 px one does not, and the sheet waits until it goes.
			await deselect();
			await h.setWindowSize(page, 844, 390);
			await sleep(900);
			await page.evaluate(() => document.body.style.setProperty('--safe-area-inset-top', '0px'));
			await sleep(300);
			const s0 = await selectPicture((x) => noteTop(x) + 10, true);
			await page.evaluate(() => app.workspace.activeLeaf.view.editor.cm.focus());
			await sleep(500);
			const rows = [];
			for (const kb of [100, 120, 140, 200]) {
				await page.evaluate((kb) => document.documentElement.style.setProperty('--keyboard-height', `${kb}px`), kb);
				await sleep(700);
				const k = await state(page);
				rows.push({
					kb,
					selected: k.selected,
					shown: k.shown,
					sheet: k.sheet,
					header: k.header,
					toolbar: k.mobileToolbar,
					noteLeft: k.shown ? k.sheet.top - noteTop(k) : null,
					problems: k.shown ? placeProblems(k, 'phone') : null,
					buttons: k.shown ? seen(k).map((x) => [x.text, x.rect.width, x.rect.height]) : null,
				});
			}
			await page.evaluate(() => {
				document.documentElement.style.removeProperty('--keyboard-height');
				document.body.style.removeProperty('--safe-area-inset-top');
				app.workspace.activeLeaf.view.editor.cm.contentDOM.blur();
			});
			await sleep(600);
			const small = rows.filter((x) => x.kb < 200);
			const big = rows.find((x) => x.kb === 200);
			check(
				`${tag} landscape, no top inset, imitated keyboard 100 to 140 px: the compact sheet shows between the header and the editing toolbar, every button at least 44 x 44 px, with at least 44 px of the note in view`,
				s0.selected && small.every((x) => x.selected && x.shown && x.problems.length === 0 && x.sheet.height <= 90 && x.noteLeft >= 44 && x.buttons.every(([, w, hh]) => w >= 44 && hh >= 44)),
				rows,
			);
			check(`${tag} landscape, no top inset, imitated keyboard 200 px: no room for the note, so the sheet waits`, big.selected && !big.shown, big);
			await deselect();
			await h.setWindowSize(page, 390, 844);
			await sleep(900);
		}

		if (size === 'phone' && runs('narrow')) {
			// ---- A narrow phone in landscape (N7) ----
			// 667 x 375 (iPhone SE 2 and 3, iPhone 6 to 8): the compact sheet is narrower, and every label still
			// stays inside its button, pressed (bold) or not, in both themes; 844 x 390 for comparison.
			const rows = [];
			for (const th of themes) {
				await page.evaluate((th) => app.changeTheme(th === 'dark' ? 'obsidian' : 'moonstone'), th);
				for (const [w, hh] of [
					[667, 375],
					[844, 390],
				]) {
					await deselect();
					await h.setWindowSize(page, w, hh);
					await sleep(900);
					await selectPicture((x) => noteTop(x) + 10);
					await tapButton('Wrap left');
					for (const segment of SEGMENTS) {
						await tapButton(segment);
						const k = await state(page);
						const labels = await spills();
						rows.push({ theme: th, size: `${w}x${hh}`, pressed: pressed(k), sheet: k.sheet, small: seen(k).filter((x) => x.rect.width < 44 || x.rect.height < 44).map((x) => x.text), spilling: labels.filter((x) => x.spills) });
					}
					await resetNote(long);
					await sleep(300);
				}
			}
			check(
				`${tag} landscape at 667 x 375 and 844 x 390: every label of the compact sheet stays inside its button, pressed or not, every button at least 44 x 44 px`,
				rows.length === themes.length * 2 * SEGMENTS.length && rows.every((x) => x.sheet.height <= 90 && x.small.length === 0 && x.spilling.length === 0),
				rows,
			);
			await deselect();
			await h.setWindowSize(page, 390, 844);
			await sleep(900);
		}

		if (size === 'tablet' && runs('tablet-keyboard')) {
			// ---- A tablet with the keyboard up (N3), imitated ----
			// When the full sheet no longer fits between the header and the keyboard (with Obsidian's editing
			// toolbar on it), the compact one (one row) takes its place: there is room for that on a tablet, and
			// the sheet stays. It is full size again once the keyboard goes.
			const s0 = await selectPicture((x) => noteTop(x) + 40, true);
			await page.evaluate(() => app.workspace.activeLeaf.view.editor.cm.focus());
			await sleep(500);
			const rows = [];
			for (const kb of [0, 250, 300, 350, 400]) {
				await page.evaluate((kb) => document.documentElement.style.setProperty('--keyboard-height', `${kb}px`), kb);
				await sleep(700);
				const k = await state(page);
				rows.push({
					kb,
					selected: k.selected,
					hasFocus: k.hasFocus,
					shown: k.shown,
					compact: compactSheet(k),
					sheet: k.sheet,
					toolbar: k.mobileToolbar,
					noteLeft: k.shown ? k.sheet.top - noteTop(k) : null,
					problems: k.shown ? placeProblems(k, 'tablet') : null,
					buttons: k.shown ? seen(k).map((x) => [x.text, x.rect.width, x.rect.height]) : null,
				});
			}
			await page.evaluate(() => document.documentElement.style.removeProperty('--keyboard-height'));
			await sleep(800);
			const back = await state(page);
			await page.evaluate(() => app.workspace.activeLeaf.view.editor.cm.contentDOM.blur());
			await sleep(400);
			check(
				`${tag} (imitated keyboard 0 to 400 px, editor focused) the sheet stays: full while it fits, else compact, above the keyboard and the editing toolbar, below the header with at least 44 px of the note in view`,
				s0.selected && rows.every((x) => x.selected && x.shown && x.problems.length === 0 && x.noteLeft >= 44 && x.buttons.every(([, w, hh]) => w >= 44 && hh >= 44)) && !rows[0].compact && rows.some((x) => x.compact),
				rows,
			);
			check(`${tag} once the keyboard goes, the full sheet is back`, back.shown && back.selected && !compactSheet(back) && placeProblems(back, 'tablet').length === 0, { shown: back.shown, sheet: back.sheet, problems: back.shown ? placeProblems(back, 'tablet') : null });
			await deselect();
		}

		if (size === 'tablet' && runs('pinned')) {
			// ---- A tablet with a pinned sidebar (N9) ----
			// A pinned sidebar sits beside the note, not over it, and is drawn above the sheet. The sheet stays within
			// the note's pane, centred there, and every button takes taps, including those on the sidebar's side.
			const steps = {
				left: [
					['Wrap left', '![[landscape.png|wrap-left|320]]'],
					['None', '![[landscape.png|wrap-left|gap-0|320]]'],
					['In line', LINK],
				],
				right: [
					['Wrap right', '![[landscape.png|wrap-right|320]]'],
					['Large', '![[landscape.png|wrap-right|gap-24|320]]'],
					['Top and bottom', '![[landscape.png|wrap-block|gap-24|320]]'],
				],
			};
			const rows = [];
			for (const side of ['left', 'right']) {
				await page.evaluate((side) => {
					const split = side === 'left' ? app.workspace.leftSplit : app.workspace.rightSplit;
					split.expand();
					split.setPinned(true);
				}, side);
				await sleep(900);
				await h.openNote(page, NOTE, 'live');
				await selectPicture((x) => noteTop(x) + 40);
				const k = await state(page);
				const where = await reach();
				const row = { side, shown: k.shown, sheet: k.sheet, pane: where.pane, problems: placeProblems(k, 'tablet', where.pane), blocked: where.buttons.filter((x) => !x.takesTap), taps: [] };
				for (const [label, want] of steps[side]) {
					await tapButton(label);
					const after = await state(page);
					// A tap that misses the sheet may reach the sidebar and make it the active view (no editor then).
					row.taps.push({ label, line: after.doc?.split('\n').find((l) => l.includes('landscape.png')) ?? null, want, shown: after.shown, active: await page.evaluate(() => app.workspace.activeLeaf?.view.getViewType()) });
				}
				rows.push(row);
				await page.evaluate((side) => {
					const split = side === 'left' ? app.workspace.leftSplit : app.workspace.rightSplit;
					split.setPinned(false);
					split.collapse();
				}, side);
				await sleep(900);
				await h.openNote(page, NOTE, 'live');
				await resetNote(long);
			}
			check(
				`${tag} with a sidebar pinned on either side, the sheet stays within the note's pane, a centred card there, and every button takes taps`,
				rows.every((x) => x.shown && x.problems.length === 0 && x.blocked.length === 0 && x.taps.every((y) => y.line === y.want)),
				rows,
			);
		}
		await deselect();
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
		if (!reviewOnly) await fixCases(size);
		await reviewCases(size);
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
