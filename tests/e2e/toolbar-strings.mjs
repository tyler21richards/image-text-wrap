// Every string the toolbar feature shows, collected from the running app: tooltips on real hover, the
// spacing dropdown, the right-click entries and the command names. All must be plain English.
//   node scripts/obsidian.mjs run tests/e2e/toolbar-strings.mjs
import { clickText, freshNote, imageRect, probe, showImage, sleep, state } from './toolbar-helpers.mjs';

const OUT = process.env.ITW_STATE_DIR ?? '.';
const ENGLISH = /^[A-Za-z0-9 ():.,'-]+$/;

export default probe(async (h, check) => {
	const { page } = h;
	await h.setWindowSize(page, 1280, 900);
	await freshNote(page, h, 'Fixture.md');
	const seen = new Set();
	const tooltips = [];
	for (const [needle, nth] of [
		['![[square.png|180]]', 0],
		['![[square.png|wrap-left|180]]', 0],
	]) {
		await clickText(page);
		await showImage(page, needle, nth);
		const img = await imageRect(page, needle, nth);
		await page.mouse.click(img.x, img.y);
		await sleep(400);
		const s = await state(page);
		await page.evaluate(() => [...document.querySelectorAll('.itw-toolbar')].forEach((t) => t.getAttribute('aria-label') && window.__itwSeen?.push(t.getAttribute('aria-label'))));
		seen.add(await page.evaluate(() => document.querySelector('.itw-toolbar')?.getAttribute('aria-label')));
		for (const b of s.buttons) {
			// Obsidian shows a tooltip after the pointer moves onto an element, so move there in steps.
			await page.mouse.move(b.rect.left + 3, b.rect.top - 20, { steps: 3 });
			await sleep(200);
			await page.mouse.move((b.rect.left + b.rect.right) / 2, (b.rect.top + b.rect.bottom) / 2, { steps: 5 });
			await sleep(1200);
			const tip = await page.evaluate(() => document.querySelector('.tooltip')?.textContent ?? null);
			tooltips.push({ label: b.label, tooltip: tip });
			seen.add(b.label);
			if (tip) seen.add(tip);
		}
		await page.screenshot({ path: `${OUT}/toolbar-tooltip.png` });
		await page.mouse.move(200, 600);
		await sleep(300);
	}
	check('every toolbar button shows its English tooltip on hover', tooltips.every((t) => t.tooltip === t.label), tooltips);
	// Spacing dropdown (the wrapped image is selected now).
	const s = await state(page);
	const spacing = s.buttons.find((b) => b.label.startsWith('Spacing'));
	await page.mouse.click((spacing.rect.left + spacing.rect.right) / 2, (spacing.rect.top + spacing.rect.bottom) / 2);
	await sleep(400);
	for (const m of (await state(page)).menu) seen.add(m.title);
	await page.keyboard.press('Escape');
	await sleep(200);
	const commands = await page.evaluate(() =>
		Object.values(app.commands.commands)
			.filter((c) => c.id.startsWith('image-text-wrap:') && !/(move|drag)/i.test(c.id))
			.map((c) => c.name),
	);
	for (const c of commands) seen.add(c.replace(/^Image Text Wrap: /, ''));
	const strings = [...seen].filter(Boolean).sort();
	check('all strings are plain English (letters, digits, spaces, basic punctuation)', strings.every((t) => ENGLISH.test(t)), strings);
});
