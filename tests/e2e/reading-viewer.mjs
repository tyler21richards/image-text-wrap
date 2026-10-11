// Reading view stand-ins and Obsidian's image viewer (src/reading/stand-ins.ts).
//
//   node scripts/obsidian.mjs run tests/e2e/reading-viewer.mjs [outDir]
//
// Obsidian's viewer (one click on a picture in Reading view) pages through every img of the note's
// sections. The stand-ins hold a copy of each wrapped picture for every section it reaches, so as img
// elements they showed up as extra pictures (a note with 4 pictures showed 6, with duplicates). On
// test-vault/Fixture.md, whose tall picture has stand-ins in three sections:
// 1. no stand-in holds an img, and every stand-in is hidden from screen readers;
// 2. a real click on the first picture opens the viewer, and real ArrowRight presses go through exactly
//    the note's own pictures, each once, in order;
// 3. scrolled down until Obsidian has taken the tall picture's section off the page, the copy shown in
//    its place is drawn (a background the size of the picture, at the same place) and the text keeps
//    its wrap. A screenshot of that goes to outDir.
import { closeLightbox } from './toolbar-helpers.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export default async ({ page, setWindowSize, openNote, watchErrors, args }) => {
	const outDir = args[0] ?? null;
	const errors = watchErrors(page);
	const results = [];
	const check = (test, ok, evidence) => results.push({ test, result: ok ? 'pass' : 'fail', evidence });
	await setWindowSize(page, 1280, 900);
	// The viewer opens in Obsidian's active window: a Settings window left open would get it instead.
	await page.evaluate(() => app.setting?.close());
	await sleep(300);
	await closeLightbox(page);
	await openNote(page, 'Fixture.md', 'reading');
	await page.evaluate(() => {
		app.workspace.activeLeaf.view.previewMode.containerEl.querySelector('.markdown-preview-view').scrollTop = 0;
	});
	await sleep(1200);
	try {
		const before = await page.evaluate(() => {
			const r = app.workspace.activeLeaf.view.previewMode.renderer;
			const standIns = r.sections.flatMap((s) => [...s.el.querySelectorAll('.itw-rv-stand-in')]);
			const imgs = r.sections.flatMap((s) => [...s.el.findAll('img')]);
			return {
				standIns: standIns.length,
				imgsInStandIns: standIns.reduce((n, s) => n + s.querySelectorAll('img').length, 0),
				hidden: standIns.every((s) => s.getAttribute('aria-hidden') === 'true'),
				// The note's own pictures, by file name.
				pictures: imgs.filter((img) => !img.closest('.itw-rv-stand-in')).map((img) => {
					const src = img.getAttribute('src') ?? '';
					return src.startsWith('data:') ? 'data URI' : (src.split('/').pop()?.split('?')[0] ?? '');
				}),
				imgs: imgs.length,
			};
		});
		check('stand-ins hold no img and are hidden from screen readers', before.standIns > 0 && before.imgsInStandIns === 0 && before.hidden, before);

		// The viewer: a real click on the first picture, then real arrow keys through all of them.
		const first = await page.evaluate(() => {
			const img = app.workspace.activeLeaf.view.previewMode.renderer.sizerEl.querySelector('.internal-embed.image-embed img');
			const b = img?.getBoundingClientRect();
			return b ? { x: b.left + b.width / 2, y: b.top + b.height / 2 } : null;
		});
		if (!first) throw new Error('no picture drawn in Reading view');
		await page.mouse.click(first.x, first.y);
		await sleep(700);
		const shown = () =>
			page.evaluate(() => {
				const imgs = [...document.querySelectorAll('.lightbox .lightbox-media img')];
				const src = imgs.pop()?.getAttribute('src');
				if (!src) return null;
				return src.startsWith('data:') ? 'data URI' : (src.split('/').pop()?.split('?')[0] ?? '');
			});
		const seen = [await shown()];
		for (let i = 0; i < before.pictures.length + 3; i++) {
			await page.keyboard.press('ArrowRight');
			await sleep(450);
			seen.push(await shown());
		}
		await closeLightbox(page);
		// The arrow keys go round: past the last picture comes the first again.
		const own = before.pictures;
		check(
			"the viewer goes through the note's own pictures, each once",
			own.length > 0 && own.every((src, i) => seen[i] === src) && seen[own.length] === own[0],
			{ pictures: own, seen },
		);

		// The copy in place once the tall picture's section is off the page.
		const swap = await page.evaluate(async () => {
			const view = app.workspace.activeLeaf.view;
			const scroller = view.previewMode.containerEl.querySelector('.markdown-preview-view');
			const sizer = view.previewMode.renderer.sizerEl;
			const frames = (n) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
			scroller.scrollTop = 0;
			await frames(3);
			const embed = sizer.querySelector('.image-embed[alt="A tall picture|wrap-right"]');
			const docTop = embed.getBoundingClientRect().top - scroller.getBoundingClientRect().top + scroller.scrollTop;
			const height = embed.getBoundingClientRect().height;
			for (let i = 0; i < 200; i++) {
				scroller.scrollTop += 40;
				await frames(2);
				await new Promise((r) => setTimeout(r, 30));
				const standIn = [...sizer.querySelectorAll('.itw-rv-stand-in')].find((s) => getComputedStyle(s).display !== 'none');
				if (!standIn) continue;
				// An img in earlier versions, which the viewer counted.
				const picture = standIn.querySelector('.itw-rv-stand-in-picture') ?? standIn.querySelector('img');
				const r = picture.getBoundingClientRect();
				const host = standIn.parentElement;
				return {
					at: scroller.scrollTop,
					imageSectionInPage: embed.isConnected,
					background: picture.tagName === 'IMG' ? 'an img' : getComputedStyle(picture).backgroundImage.slice(0, 40),
					copyTopVsImageTop: Math.round((r.top - scroller.getBoundingClientRect().top + scroller.scrollTop - docTop) * 10) / 10,
					copyHeightVsImage: Math.round((r.height - height) * 10) / 10,
					textRightOfCopy: (() => {
						let right = -Infinity;
						const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
						for (let n; (n = walker.nextNode()); ) {
							if (!n.textContent.trim()) continue;
							const range = document.createRange();
							range.selectNodeContents(n);
							for (const b of range.getClientRects()) if (b.width > 1 && b.top < standIn.getBoundingClientRect().bottom) right = Math.max(right, b.right);
						}
						return right === -Infinity ? null : Math.round(standIn.getBoundingClientRect().left - right);
					})(),
				};
			}
			return null;
		});
		check(
			"the copy shown in place of the tall picture's section is drawn where the picture was, and the text stays beside it",
			!!swap && !swap.imageSectionInPage && swap.background.startsWith('url(') && Math.abs(swap.copyTopVsImageTop) <= 1 && Math.abs(swap.copyHeightVsImage) <= 1 && swap.textRightOfCopy !== null && swap.textRightOfCopy >= 0,
			swap,
		);
		if (outDir && swap) {
			await page.evaluate((top) => {
				app.workspace.activeLeaf.view.previewMode.containerEl.querySelector('.markdown-preview-view').scrollTop = top + 80;
			}, swap.at);
			await sleep(400);
			await page.screenshot({ path: `${outDir}/viewer-copy-in-place.png` });
		}
	} finally {
		await closeLightbox(page);
	}
	check('no console errors', errors.length === 0, errors);
	return results;
};
