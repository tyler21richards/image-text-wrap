// R5 parity: each wrapped image of test-vault/Fixture.md in Live Preview, Reading view and the PDF
// print window: image size, where the first wrapped line sits against the image top, which blocks sit
// beside it and whether any of them runs under the image. Screenshots of each image's region in
// Live Preview and Reading view, and PNG renders of the PDF pages, go to args[0] (an output folder).
//
//   node scripts/obsidian.mjs run tests/e2e/reading-parity.mjs <outDir>
import { measureInView, measureWraps, settle, textOffsets } from './reading-measure.mjs';
import { exportPdf } from './pdf-export.mjs';
import { pdfPages, renderClips, wrapsInPdf } from './pdf-pages.mjs';

const NOTE = 'Fixture.md';
const OFFSET_TEXTS = ['A list item that sits', 'A quote that should', 'A callout', 'The callout background'];

export default async ({ page, args, openNote, setWindowSize, watchErrors }) => {
	const outDir = args[0];
	if (!outDir) throw new Error('usage: reading-parity.mjs <outDir>');
	const errors = watchErrors(page);
	await setWindowSize(page, 1280, 900);
	const text = await page.evaluate((p) => app.vault.read(app.vault.getAbstractFileByPath(p)), NOTE);
	// Lines holding an image wrapped left or right, outside the transcluded note.
	const targets = text
		.split('\n')
		.map((line, n) => ({ line, n }))
		.filter(({ line }) => /^!\[.*wrap-(left|right)/.test(line));
	const key = (alt) => (alt ?? '').replace(/\\$/, '');
	const result = { window: await page.evaluate(() => [innerWidth, innerHeight, devicePixelRatio]), views: {} };

	for (const mode of ['live', 'reading']) {
		await openNote(page, NOTE, mode);
		await settle(page, 400);
		const rows = [];
		for (const { line, n } of targets) {
			await page.evaluate(
				({ n, mode }) => {
					const view = app.workspace.activeLeaf.view;
					if (mode === 'reading') view.previewMode.applyScroll(Math.max(0, n - 1));
					else {
						// The image's own line near the top of the editor, so the whole image fits the screenshot.
						const cm = view.editor.cm;
						const pos = cm.state.doc.line(n + 1).from;
						cm.dispatch({ effects: cm.constructor.scrollIntoView(pos, { y: 'start', yMargin: 80 }) });
					}
				},
				{ n, mode },
			);
			await settle(page, 300);
			const all = await measureInView(page, mode);
			const alt = line.match(/\|([^\]]*?)\|\d+\]\]$/)?.[1] ?? line.match(/^!\[([^\]]*?)\|\d+\]/)?.[1];
			const found = all.find((m) => key(m.alt) === alt);
			if (found) {
				// Where the blocks after the tall image's paragraph start, against the image top: shows the
				// paragraph spacing difference between the views (an editor blank line is a 24 px line).
				found.blockOffsets = await page.evaluate(
					({ src, mode, top, texts }) => {
						const fn = new Function(`return (${src})`)();
						const leafEl = app.workspace.activeLeaf.view.containerEl;
						const root = leafEl.querySelector(mode === 'live' ? '.cm-content' : '.markdown-reading-view .markdown-preview-sizer');
						return fn(document, window, root, top, texts);
					},
					{ src: textOffsets.toString(), mode, top: found.img.t, texts: OFFSET_TEXTS },
				);
				rows.push({ line: n, ...found });
				const column = await page.evaluate((mode) => {
					const leafEl = app.workspace.activeLeaf.view.containerEl;
					const el = leafEl.querySelector(mode === 'live' ? '.cm-content' : '.markdown-reading-view .markdown-preview-sizer');
					const r = el.getBoundingClientRect();
					return { l: r.left, w: r.width };
				}, mode);
				const clip = { x: column.l - 30, y: Math.max(0, found.img.t - 40), width: column.w + 60, height: Math.min(found.img.h + 80, 820) };
				await page.screenshot({ path: `${outDir}/${mode}-line${n}.png`, clip });
			} else rows.push({ line: n, missing: alt, seen: all.map((m) => m.alt) });
		}
		result.views[mode] = rows;
	}

	// PDF: the whole note is laid out at once in the print window.
	await openNote(page, NOTE, 'reading');
	const pdf = await exportPdf(page, {
		dest: `${outDir}/fixture.pdf`,
		measure: new Function(
			'doc',
			'win',
			'root',
			`const m = (${measureWraps.toString()})(doc, win, root);
			 const pw = root.getBoundingClientRect().width;
			 return { rootWidth: pw, rootClass: root.className, wraps: m,
			   printFloats: [...root.querySelectorAll('.itw-print-float')].map((e) => e.tagName + ':' + e.textContent.slice(0, 30)),
			   keep: [...root.querySelectorAll('.itw-print-keep-with-next')].map((e) => e.tagName + ':' + e.textContent.slice(0, 30)),
			   maxWidthVar: win.getComputedStyle(root).getPropertyValue('--itw-max-width') };`,
		),
	});
	result.print = { steps: pdf.steps, error: pdf.error, header: pdf.header, size: pdf.size, ...pdf.result };
	try {
		const pages = pdfPages(pdf.dest, `${outDir}/fixture`);
		result.pdfPages = pages.map((p) => ({ page: p.page, images: p.images, firstLine: p.lines[0]?.text, lastLine: p.lines.at(-1)?.text }));
		result.pdfWraps = wrapsInPdf(pages);
		// The same block offsets in the PDF, against the tall image (the one on its page beside a list).
		const tall = result.pdfWraps.find((w) => w.side === 'right' && w.h > 500);
		if (tall) {
			const lines = pages[tall.page - 1].lines;
			result.pdfBlockOffsets = Object.fromEntries(
				OFFSET_TEXTS.map((t) => {
					const l = lines.find((x) => x.text.startsWith(t));
					return [t, l ? Math.round((l.y0 * (96 / 72) - tall.topPx) * 10) / 10 : null];
				}),
			);
		}
		const PT = 72 / 96;
		renderClips(
			pdf.dest,
			result.pdfWraps
				.filter((w) => w.side !== 'centre' && w.beside > 0)
				.map((w, i) => ({ page: w.page, y0: (w.topPx - 40) * PT, y1: (w.bottomPx + 40) * PT, out: `${outDir}/pdf-wrap${i + 1}.png` })),
		);
	} catch (e) {
		result.pdfPages = String(e);
	}
	result.errors = errors;
	return result;
};
