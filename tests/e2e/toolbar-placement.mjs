// M2 acceptance, part 3: where the toolbar goes. It never covers Obsidian's own controls on the image
// (zoom/edit at the top right, the resize corner at the bottom right), stays in the note column and the
// visible scroller, and sits above the picture, below it, or (for a picture taller than the visible area)
// inside its top-left corner.
//   node scripts/obsidian.mjs run tests/e2e/toolbar-placement.mjs
import { clickText, closeLightbox, drawn, freshNote, geometryProblems, imageRect, probe, showImage, sleep, state } from './toolbar-helpers.mjs';

const OUT = process.env.ITW_STATE_DIR;

async function select(page, needle, nth = 0) {
	const img = await imageRect(page, needle, nth);
	if (!img.found) return null;
	// Click a visible part of the picture, away from Obsidian's controls.
	const scroller = (await state(page)).scroller;
	const top = Math.max(img.top, scroller.top);
	const bottom = Math.min(img.bottom, scroller.bottom);
	await page.mouse.click(img.left + 20, (top + bottom) / 2);
	await sleep(450);
	return state(page);
}

/** Scrolls so the picture's top edge is `offset` px below the top of the visible scroller (negative: above it). */
async function placePicture(page, needle, offset) {
	await showImage(page, needle);
	for (let i = 0; i < 3; i++) {
		const img = await imageRect(page, needle);
		await page.evaluate(
			({ top, offset }) => {
				const cm = app.workspace.activeLeaf.view.editor.cm;
				cm.scrollDOM.scrollTop += top - (cm.scrollDOM.getBoundingClientRect().top + offset);
			},
			{ top: img.top, offset },
		);
		await sleep(300);
	}
}

function summary(s) {
	return { placement: s.placement, toolbar: s.toolbar, picture: s.picture, native: s.native.map((n) => `${n.cls}@${n.left},${n.top},${n.right},${n.bottom}`), problems: geometryProblems(s) };
}

/**
 * Clicks a sidebar's toggle button and records, after each frame is painted, where the toolbar and the
 * selected picture were. Returns the frames in which the toolbar was more than 2 px off its place on the
 * picture (its offset once everything has settled).
 */
async function slide(page, side) {
	await page.evaluate(() => {
		const frames = (window.__itwSlide = []);
		const cm = app.workspace.activeLeaf.view.editor.cm;
		// A task posted from each animation frame runs after that frame's layout, resize notifications and
		// paint: it sees what was on screen.
		const channel = new MessageChannel();
		channel.port1.onmessage = () => {
			if (window.__itwSlide !== frames) return;
			const tb = [...document.querySelectorAll('.itw-toolbar')].find((t) => !t.classList.contains('itw-toolbar-hidden'))?.getBoundingClientRect();
			const pic = cm.contentDOM.querySelector('.image-embed.is-selected img')?.getBoundingClientRect();
			frames.push(tb && pic ? { x: Math.round(tb.left - pic.left), y: Math.round(tb.top - pic.top), pic: Math.round(pic.left) } : null);
		};
		const tick = () => {
			if (window.__itwSlide !== frames) return;
			channel.port2.postMessage(0);
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	});
	const button = await page.evaluate((side) => {
		const r = document.querySelector(`.sidebar-toggle-button.mod-${side}`)?.getBoundingClientRect();
		return r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
	}, side);
	if (!button) throw new Error(`no ${side} sidebar toggle button`);
	await page.mouse.click(button.x, button.y);
	await sleep(800);
	const frames = await page.evaluate(() => {
		const f = window.__itwSlide;
		delete window.__itwSlide;
		return f;
	});
	const last = frames[frames.length - 1];
	const moved = frames.filter(Boolean).map((f) => f.pic);
	return {
		frames: frames.length,
		hidden: frames.filter((f) => !f).length,
		pictureMoved: Math.max(...moved) - Math.min(...moved),
		off: last ? frames.filter((f) => f && (Math.abs(f.x - last.x) > 2 || Math.abs(f.y - last.y) > 2)) : ['no toolbar at the end'],
	};
}

export default probe(async (h, check, restore) => {
	const { page } = h;
	const errors = h.watchErrors(page);
	await h.setWindowSize(page, 1280, 900);

	// Every image in the fixture, centred.
	await freshNote(page, h, 'Fixture.md');
	const fixtureImages = [
		'![[landscape.png|wrap-left|300]]',
		'![[tall.png|A tall picture|wrap-right|260]]',
		'![[square.png|wrap-left|180]]',
		'![[square.png|180]]',
		'![[landscape.png|wrap-block|360]]',
		'![teal|wrap-right|120]',
	];
	for (const needle of fixtureImages) {
		await clickText(page);
		await showImage(page, needle);
		const s = await select(page, needle);
		check(`Fixture ${needle.slice(0, 40)}: placed clear of native controls, in column and scroller`, !!s && s.visible && geometryProblems(s).length === 0, s && summary(s));
	}

	// A picture partly scrolled off the top: no room above, so the toolbar goes below it.
	await clickText(page);
	await placePicture(page, '![[landscape.png|wrap-block|360]]', -60);
	let s = await select(page, '![[landscape.png|wrap-block|360]]');
	check('picture cut off at the top: toolbar below it', !!s && s.visible && s.placement === 'below' && geometryProblems(s).length === 0, s && summary(s));
	// And one cut off at the bottom: toolbar above it.
	await clickText(page);
	const height = (await state(page)).scroller;
	await placePicture(page, '![[landscape.png|wrap-block|360]]', height.bottom - height.top - 120);
	s = await select(page, '![[landscape.png|wrap-block|360]]');
	check('picture cut off at the bottom: toolbar above it', !!s && s.visible && s.placement === 'above' && geometryProblems(s).length === 0 && s.picture.bottom > s.scroller.bottom, s && summary(s));

	// A picture taller than the visible area, its top just inside the scroller (no room above for the
	// toolbar, none below): the toolbar goes inside the picture's top-left corner, clear of the controls.
	await h.setWindowSize(page, 1280, 600);
	await freshNote(page, h, 'Plain images.md');
	await placePicture(page, '![[tall.png]]', 20);
	s = await select(page, '![[tall.png]]');
	check('picture taller than the visible area: toolbar inside it, clear of the controls', !!s && s.visible && s.placement === 'inside' && geometryProblems(s).length === 0 && s.picture.bottom - s.picture.top > s.scroller.bottom - s.scroller.top, s && summary(s));
	await page.screenshot({ path: `${OUT}/agent-1/placement-tall.png` });
	// Scroll through the tall picture: the toolbar stays clear of the controls the whole way.
	const steps = [];
	await page.mouse.move(900, 400);
	for (let i = 0; i < 8; i++) {
		await page.mouse.wheel(0, 150);
		await sleep(250);
		const t = await state(page);
		steps.push({ scrollTop: t.scrollTop, visible: t.visible, placement: t.placement, problems: t.visible ? geometryProblems(t) : [] });
	}
	check('scrolling through a tall picture: never covers a control or leaves the scroller', steps.every((x) => x.problems.length === 0), steps);
	await closeLightbox(page);

	// A narrow window: the toolbar stays inside the note column.
	await h.setWindowSize(page, 760, 800);
	await freshNote(page, h, 'Fixture.md');
	await showImage(page, '![[tall.png|A tall picture|wrap-right|260]]');
	s = await select(page, '![[tall.png|A tall picture|wrap-right|260]]');
	check('narrow window (760 px): toolbar inside the column and clear of the controls', !!s && s.visible && geometryProblems(s).length === 0, s && summary(s));
	await page.screenshot({ path: `${OUT}/agent-1/placement-narrow.png` });

	await h.setWindowSize(page, 1280, 900);

	// A sidebar closing and opening again slides the note column across: the toolbar stays on the picture
	// in every painted frame (it used to trail it by several frames, up to 200 px).
	await freshNote(page, h, 'Plain images.md');
	const picture = drawn(await showImage(page, '![[landscape.png|320]]'), '![[landscape.png|320]]');
	await page.mouse.click(picture.x, picture.y);
	await sleep(450);
	const leftCollapsed = await page.evaluate(() => app.workspace.leftSplit.collapsed);
	restore(() =>
		page.evaluate((collapsed) => {
			const split = app.workspace.leftSplit;
			if (split.collapsed !== collapsed) collapsed ? split.collapse() : split.expand();
		}, leftCollapsed),
	);
	const slides = [await slide(page, 'left'), await slide(page, 'left')];
	check(
		'a sidebar sliding closed and open: the toolbar keeps its place on the picture in every painted frame',
		slides.every((x) => x.off.length === 0 && x.hidden === 0 && x.pictureMoved > 50) && (await page.evaluate(() => app.workspace.leftSplit.collapsed)) === leftCollapsed,
		slides,
	);
	check('no console errors', errors.length === 0, errors);
});
