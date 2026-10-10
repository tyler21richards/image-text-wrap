// Checks that the drop outline shows where the image will really be drawn, including when an earlier
// image on the same side pushes it down (same-side floats stack).
//
//   node scripts/obsidian.mjs run tests/e2e/drag-landing.mjs <screenshot dir>
import { mkdirSync } from 'node:fs';
import * as d from './drag-lib.mjs';

const SQUARE = 47; // ![[square.png|wrap-left|180]]
const QUOTE = 20; // > A quote ... (beside the tall right-hand image)
const RAIN = 7; // "Rain here..." (no float beside it)

export default async ({ page, setWindowSize, openNote, args }) => {
	const out = args[0] ?? '.';
	mkdirSync(out, { recursive: true });
	await setWindowSize(page, 1280, 900);
	await openNote(page, d.FIXTURE, 'live');
	const report = [];
	for (const [name, target, from, side] of [
		['beside the tall right image', QUOTE, SQUARE, 'right'],
		['no float in the way', RAIN, SQUARE, 'left'],
	]) {
		await d.resetNote(page, null);
		await d.scrollToLine(page, target - 6, 0);
		// Bring the source on screen by scrolling while dragging is not needed: start from a known place.
		await d.scrollToLine(page, from - 1, 40);
		const g = await d.geometry(page, from);
		const start = { x: g.img.left + g.img.width / 2, y: g.img.top + g.img.height / 2 };
		await page.mouse.move(start.x, start.y);
		await page.mouse.down();
		await page.mouse.move(start.x + 10, start.y + 10, { steps: 3 });
		const x = side === 'left' ? g.column.left + 60 : g.column.right - 60;
		let y = await d.lineY(page, target);
		for (let i = 0; i < 300 && y < g.scroller.top + 150; i++) {
			await page.mouse.move(x, g.scroller.top + 4, { steps: 1 });
			await d.frames(page, 1);
			y = await d.lineY(page, target);
		}
		await page.mouse.move(x, (g.scroller.top + g.scroller.bottom) / 2, { steps: 3 });
		await d.sleep(150);
		y = await d.lineY(page, target);
		await page.mouse.move(x, y + 4, { steps: 6 });
		await d.frames(page, 3);
		const during = await d.dragState(page);
		await page.screenshot({ path: `${out}/landing-${target}-during.png` });
		await page.mouse.up();
		await d.sleep(300);
		await d.frames(page, 2);
		const landed = await page.evaluate(() => {
			const cm = app.workspace.activeLeaf.view.editor.cm;
			const lines = cm.state.doc.toString().split('\n');
			const at = lines.findIndex((l) => /^!\[\[square\.png\|wrap-(left|right)\|180\]\]$/.test(l));
			const l = cm.state.doc.line(at + 1);
			for (const el of cm.contentDOM.querySelectorAll('.internal-embed.image-embed')) {
				const pos = cm.posAtDOM(el);
				if (pos >= l.from && pos <= l.to) {
					const b = el.getBoundingClientRect();
					return { line: at, top: Math.round(b.top), left: Math.round(b.left) };
				}
			}
			return { line: at };
		});
		await page.screenshot({ path: `${out}/landing-${target}-after.png` });
		report.push({
			name,
			bar: during.bar?.top,
			box: during.box && { top: during.box.top, left: during.box.left },
			landed,
			boxError: during.box ? Math.abs(during.box.top - landed.top) : null,
		});
	}
	await d.resetNote(page, null);
	return report;
};
