// M2 acceptance, part 1: show and hide, every button, one undo step each, no scrolling.
//   node scripts/obsidian.mjs run tests/e2e/toolbar-basic.mjs
import {
	clickButton,
	clickText,
	diffLines,
	freshNote,
	geometryProblems,
	pressed,
	showImage,
	sleep,
	sourceNote,
	state,
} from './toolbar-helpers.mjs';

const NOTE = 'Plain images.md';
const LINK = '![[landscape.png|320]]';

export default async (h) => {
	const { page } = h;
	const errors = h.watchErrors(page);
	await h.setWindowSize(page, 1280, 900);
	const results = [];
	const check = (test, ok, evidence) => results.push({ test, result: ok ? 'pass' : 'fail', evidence });
	const original = sourceNote(NOTE);

	await freshNote(page, h, NOTE);
	let img = await showImage(page, LINK);
	await page.mouse.click(img.x, img.y);
	await sleep(400);
	let s = await state(page);
	check('appears on select', s.visible && s.selected, { placement: s.placement, toolbar: s.toolbar, picture: s.picture });
	check('in line pressed, spacing disabled', pressed(s).join() === 'In line with text' && s.buttons[4].disabled, s.buttons.map((b) => [b.label, b.pressed, b.disabled]));
	check('geometry (column, scroller, native controls)', geometryProblems(s).length === 0, { problems: geometryProblems(s), native: s.native, toolbar: s.toolbar });

	// Spacing is disabled while in line: a click opens nothing and writes nothing.
	await clickButton(page, 'Spacing');
	s = await state(page);
	check('disabled spacing does nothing', s.menu.length === 0 && s.doc === original, { menu: s.menu.length });

	// Each action: only this link changes, the image stays selected, no scrolling, one undo step.
	const docs = [s.doc];
	const actions = [
		['Wrap text left', '![[landscape.png|wrap-left|320]]'],
		['Wrap text left', LINK], // clicking the active wrap button turns wrapping off
		['Wrap text right', '![[landscape.png|wrap-right|320]]'],
		['Spacing', null], // opens the menu
		['Large (24 px)', '![[landscape.png|wrap-right|gap-24|320]]'],
		['Top and bottom', '![[landscape.png|wrap-block|gap-24|320]]'],
		['In line with text', LINK],
	];
	for (const [label, expected] of actions) {
		const before = await state(page);
		if (label === 'Large (24 px)') {
			const { clickMenuItem } = await import('./toolbar-helpers.mjs');
			check('spacing menu lists the four choices, medium checked', before.menu.map((m) => m.title).join('|') === 'None|Small (8 px)|Medium (16 px)|Large (24 px)' && before.menu.find((m) => m.checked)?.title === 'Medium (16 px)', before.menu);
			await clickMenuItem(page, label);
		} else {
			await clickButton(page, label);
		}
		await sleep(250);
		const after = await state(page);
		if (expected === null) continue;
		const diff = diffLines(before.doc, after.doc);
		const want = before.doc === after.doc ? [] : [{ line: 5, before: before.doc.split('\n')[4], after: expected }];
		check(`"${label}" changes only this link`, JSON.stringify(diff) === JSON.stringify(want) && after.doc.split('\n')[4] === expected, diff);
		check(`"${label}" keeps the image selected and the toolbar in sync`, after.selected && after.visible && after.selPos === img.pos, { selected: after.selected, visible: after.visible, pressed: pressed(after), selPos: after.selPos });
		check(`"${label}" does not scroll`, after.scrollTop === before.scrollTop, [before.scrollTop, after.scrollTop]);
		check(`"${label}" keeps editor focus`, after.hasFocus, after.hasFocus);
		const wantPressed = { [LINK]: 'In line with text' }[expected] ?? (expected.includes('wrap-left') ? 'Wrap text left' : expected.includes('wrap-right') ? 'Wrap text right' : 'Top and bottom');
		check(`"${label}" pressed state`, pressed(after).join() === wantPressed, pressed(after));
		check(`"${label}" geometry`, geometryProblems(after).length === 0, geometryProblems(after));
		docs.push(after.doc);
	}

	// Undo walks back one action per Cmd+Z, without scrolling.
	const top = (await state(page)).scrollTop;
	const undone = [];
	for (let i = docs.length - 2; i >= 0; i--) {
		await page.keyboard.press('Meta+z');
		await sleep(300);
		const s2 = await state(page);
		undone.push({ step: i, ok: s2.doc === docs[i], scrollTop: s2.scrollTop, selected: s2.selected, visible: s2.visible });
	}
	check('one undo step per action (Cmd+Z restores each in turn)', undone.every((u) => u.ok), undone);
	check('undo does not scroll', undone.every((u) => u.scrollTop === top), undone.map((u) => u.scrollTop));
	s = await state(page);
	check('fully undone equals the original note', s.doc === original, diffLines(original, s.doc));

	// Esc hides the toolbar but leaves Obsidian's selection alone; a new click brings it back.
	await clickText(page);
	img = await showImage(page, LINK);
	await page.mouse.click(img.x, img.y);
	await sleep(350);
	await page.keyboard.press('Escape');
	await sleep(300);
	s = await state(page);
	check('Esc hides the toolbar (image stays selected by Obsidian)', !s.visible && s.selected, { visible: s.visible, selected: s.selected });
	await clickText(page);
	s = await state(page);
	check('deselect (click in text) hides it', !s.visible && !s.selected, { visible: s.visible, selected: s.selected });
	await page.mouse.click(img.x, img.y);
	await sleep(350);
	s = await state(page);
	check('selecting again after Esc shows it', s.visible && s.selected, { visible: s.visible });

	// Scrolling the picture out of the visible scroller hides the toolbar; scrolling back shows it.
	await page.mouse.move(800, 600);
	const steps = [];
	for (let i = 0; i < 6; i++) {
		await page.mouse.wheel(0, 200);
		await sleep(200);
		const s2 = await state(page);
		steps.push({ scrollTop: s2.scrollTop, visible: s2.visible, pictureBottom: s2.picture?.bottom, scrollerTop: s2.scroller.top, problems: s2.visible ? geometryProblems(s2) : [] });
	}
	const out = steps.find((x) => x.pictureBottom <= x.scrollerTop);
	check('hides when the picture scrolls out of view', !!out && !out.visible && steps.every((x) => !x.visible || x.problems.length === 0), steps);
	for (let i = 0; i < 6; i++) {
		await page.mouse.wheel(0, -200);
		await sleep(200);
	}
	s = await state(page);
	check('shows again when scrolled back', s.visible && s.selected, { visible: s.visible, scrollTop: s.scrollTop });

	// Switching the note to Source mode or Reading view hides it.
	await page.evaluate(() => app.commands.executeCommandById('editor:toggle-source'));
	await sleep(400);
	s = await state(page);
	check('hidden in Source mode', !s.visible, { visible: s.visible });
	await page.evaluate(() => app.commands.executeCommandById('editor:toggle-source'));
	await sleep(400);
	await clickText(page);
	img = await showImage(page, LINK);
	await page.mouse.click(img.x, img.y);
	await sleep(350);
	await page.evaluate(() => app.commands.executeCommandById('markdown:toggle-preview'));
	await sleep(500);
	s = await page.evaluate(() => ({ visible: [...document.querySelectorAll('.itw-toolbar')].some((t) => !t.classList.contains('itw-toolbar-hidden')) }));
	check('hidden after switching to Reading view', !s.visible, s);
	await page.evaluate(() => app.commands.executeCommandById('markdown:toggle-preview'));
	await sleep(500);

	check('no console errors', errors.length === 0, errors);
	await h.setNote(page, NOTE, original);
	return results;
};
