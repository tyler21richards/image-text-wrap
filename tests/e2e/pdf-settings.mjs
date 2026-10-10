// The "Widest wrapped image" setting must reach the PDF, which renders in a window of its own.
// Sets it to 30%, exports test-vault/Fixture.md, and compares the wrapped images' widths in Reading view
// and in the PDF against 30% of each column. Restores the setting afterwards.
//
//   node scripts/obsidian.mjs run tests/e2e/pdf-settings.mjs <outDir>
import { exportPdf } from './pdf-export.mjs';
import { pdfPages, wrapsInPdf } from './pdf-pages.mjs';
import { measureInView, settle } from './reading-measure.mjs';

export default async ({ page, args, openNote, setWindowSize, watchErrors }) => {
	const outDir = args[0];
	const errors = watchErrors(page);
	await setWindowSize(page, 1280, 900);
	const saved = await page.evaluate(() => ({ ...app.plugins.plugins['image-text-wrap'].settings }));
	try {
		await page.evaluate(() => {
			const p = app.plugins.plugins['image-text-wrap'];
			return p.updateSettings({ ...p.settings, maxWrapWidth: 30 });
		});
		await openNote(page, 'Fixture.md', 'reading');
		await settle(page, 300);
		const column = await page.evaluate(() =>
			app.workspace.activeLeaf.view.containerEl.querySelector('.markdown-reading-view .markdown-preview-sizer').getBoundingClientRect().width,
		);
		const reading = (await measureInView(page, 'reading')).map((m) => ({ alt: m.alt, w: m.img.w }));
		const pdf = await exportPdf(page, {
			dest: `${outDir}/fixture-30.pdf`,
			measure: (doc, win, root) => win.getComputedStyle(root).getPropertyValue('--itw-max-width'),
		});
		const pages = pdfPages(pdf.dest);
		const pdfColumnPx = Math.round(((pages[0].lines.reduce((m, l) => Math.max(m, l.x1), 0) - pages[0].lines.reduce((m, l) => Math.min(m, l.x0), 1e9)) * 96) / 72);
		return {
			readingColumn: column,
			readingLimit: Math.round(column * 0.3),
			reading,
			printVar: pdf.result,
			pdfColumnPx,
			pdfLimit: Math.round(pdfColumnPx * 0.3),
			pdfFloats: wrapsInPdf(pages).filter((w) => w.side !== 'centre' && w.beside > 0).map((w) => `${w.w}x${w.h}`),
			errors,
		};
	} finally {
		await page.evaluate((s) => app.plugins.plugins['image-text-wrap'].updateSettings(s), saved);
	}
};
