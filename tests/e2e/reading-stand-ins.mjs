// Reading view stand-ins (src/reading/stand-ins.ts) with an image so tall that part of it is still on
// screen when Obsidian takes its section off the page: the text must keep its wrap (no jump) and the
// visible part of the picture must stay exactly where it was (its clipped copy shows instead).
// Uses "Widest wrapped image" = 80% for a 1260 px tall image; the setting is restored afterwards.
//
//   node scripts/obsidian.mjs run tests/e2e/reading-stand-ins.mjs <outDir>
import { settle } from './reading-measure.mjs';

const NOTE = 'Reading stand-ins.md';
const TEXT = `# Stand-ins

Some text before the image.

![[tall.png|wrap-right|600]]
A short paragraph glued to a very tall image.

${Array.from({ length: 60 }, (_, i) => `Paragraph ${i + 1}. Short lines of text beside the tall picture, wrapping around it.`).join('\n\n')}
`;

export default async ({ page, args, setNote, openNote, setWindowSize, watchErrors }) => {
	const outDir = args[0];
	const errors = watchErrors(page);
	await setWindowSize(page, 1280, 900);
	const saved = await page.evaluate(() => ({ ...app.plugins.plugins['image-text-wrap'].settings }));
	try {
		await page.evaluate(() => {
			const p = app.plugins.plugins['image-text-wrap'];
			return p.updateSettings({ ...p.settings, maxWrapWidth: 80 });
		});
		await setNote(page, NOTE, TEXT);
		await openNote(page, NOTE, 'reading');
		await settle(page, 600);
		const result = await page.evaluate(async () => {
			const view = app.workspace.activeLeaf.view;
			const scroller = view.previewMode.containerEl.querySelector('.markdown-preview-view');
			const sizer = view.previewMode.renderer.sizerEl;
			const frames = (n) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
			const embed = sizer.querySelector('.image-embed');
			const r0 = embed.querySelector('img').getBoundingClientRect();
			// The image's place in the note's own coordinates.
			const docTop = r0.top - scroller.getBoundingClientRect().top + scroller.scrollTop;
			const imgSize = [Math.round(r0.width), Math.round(r0.height)];
			const jumps = [];
			const swaps = [];
			let shownBefore = false;
			for (let i = 0; i < 80; i++) {
				const anchors = [...sizer.children].filter((el) => {
					const r = el.getBoundingClientRect();
					const s = scroller.getBoundingClientRect();
					return !el.classList.contains('markdown-preview-pusher') && r.height > 0 && r.top > s.top + 40 && r.bottom < s.bottom - 40;
				}).slice(0, 8).map((el) => [el, el.getBoundingClientRect().top]);
				const start = scroller.scrollTop;
				scroller.scrollTop = start + 40;
				await frames(2);
				await new Promise((r) => setTimeout(r, 30));
				const moved = scroller.scrollTop - start;
				if (!moved) break;
				let worst = 0;
				for (const [el, top] of anchors) if (el.isConnected) {
					const e = el.getBoundingClientRect().top - (top - moved);
					if (Math.abs(e) > Math.abs(worst)) worst = e;
				}
				if (Math.abs(worst) > 2) jumps.push({ at: start, px: Math.round(worst * 10) / 10 });
				const shown = [...sizer.querySelectorAll('.itw-rv-stand-in')].find((s) => getComputedStyle(s).display !== 'none');
				if (shown && !shownBefore) {
					const copy = shown.querySelector('img').getBoundingClientRect();
					const copyDocTop = copy.top - scroller.getBoundingClientRect().top + scroller.scrollTop;
					const box = shown.getBoundingClientRect();
					swaps.push({
						at: start,
						imageSectionInPage: embed.isConnected,
						copyTopVsImageTop: Math.round((copyDocTop - docTop) * 10) / 10,
						copySize: [Math.round(copy.width), Math.round(copy.height)],
						visiblePartOnScreen: Math.round(box.bottom - scroller.getBoundingClientRect().top),
					});
				}
				shownBefore = !!shown;
			}
			return { imgSize, jumps, swaps, finalScroll: scroller.scrollTop };
		});
		// A screenshot right after the swap shows the copy in place.
		await page.evaluate((top) => {
			const scroller = app.workspace.activeLeaf.view.previewMode.containerEl.querySelector('.markdown-preview-view');
			scroller.scrollTop = top;
		}, (result.swaps[0]?.at ?? 0) + 120);
		await settle(page, 300);
		if (outDir) await page.screenshot({ path: `${outDir}/stand-in-shown.png` });
		result.errors = errors;
		return result;
	} finally {
		await page.evaluate((s) => app.plugins.plugins['image-text-wrap'].updateSettings(s), saved);
	}
};
