// Brief M4: wrapped images at page breaks in a PDF export of test-vault/"PDF page breaks.md"
// (written by scripts/make-page-breaks.mjs).
//
// For every wrapped image: it must be whole on one page, its own paragraph must start beside it on that
// page (not stranded on a page apart from its text), and a heading right before it must be on the same
// page. Also reports how full each page is, to spot half-blank pages. The same export is made a second
// time with the plugin's page-break rules switched off in the print window, as the control.
//
//   node scripts/obsidian.mjs run tests/e2e/pdf-page-breaks.mjs <outDir>
import { exportPdf } from './pdf-export.mjs';
import { pdfPages, wrapsInPdf } from './pdf-pages.mjs';

const NOTE = 'PDF page breaks.md';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function expectations(text) {
	const lines = text.split('\n');
	const out = [];
	lines.forEach((line, n) => {
		if (!/^!\[\[.*wrap-(left|right)/.test(line)) return;
		let h = n - 1;
		while (h >= 0 && lines[h].trim() === '') h--;
		out.push({
			link: line,
			side: line.includes('wrap-left') ? 'left' : 'right',
			firstWords: lines[n + 1].split(' ').slice(0, 4).join(' '),
			heading: /^#{1,6} /.test(lines[h] ?? '') ? lines[h].replace(/^#+ /, '') : null,
		});
	});
	return out;
}

function check(pages, expected) {
	const wraps = wrapsInPdf(pages).filter((w) => w.side !== 'centre');
	const rows = expected.map((e, i) => {
		const w = wraps[i];
		if (!w) return { link: e.link, missing: true };
		const page = pages[w.page - 1];
		const headingPage = e.heading ? pages.find((p) => p.lines.some((l) => l.text === e.heading))?.page ?? null : null;
		const ownTextBeside = page.lines.some(
			(l) =>
				l.text.startsWith(e.firstWords) &&
				l.y1 * (96 / 72) > w.topPx &&
				l.y0 * (96 / 72) < w.bottomPx,
		);
		return {
			link: e.link,
			page: w.page,
			side: w.side,
			sideOk: w.side === e.side,
			size: `${w.w}x${w.h}`,
			topPx: w.topPx,
			bottomPx: w.bottomPx,
			beside: w.beside,
			ownTextBeside,
			heading: e.heading,
			headingPage,
			headingWithImage: e.heading ? headingPage === w.page : null,
		};
	});
	const fill = pages.map((p) => {
		const bottoms = [...p.lines.map((l) => l.y1), ...p.images.map((i) => i.y1)];
		return Math.round((Math.max(0, ...bottoms) / p.height) * 100);
	});
	return {
		pages: pages.length,
		images: wraps.length,
		rows,
		pageFillPercent: fill,
		stranded: rows.filter((r) => !r.missing && !r.ownTextBeside).length,
		headingSplit: rows.filter((r) => r.headingWithImage === false).length,
		wrongSize: rows.filter((r) => r.missing).length,
	};
}

export default async ({ page, args, cfg, syncVault, openNote, setWindowSize, watchErrors }) => {
	const outDir = args[0];
	if (!outDir) throw new Error('usage: pdf-page-breaks.mjs <outDir>');
	const errors = watchErrors(page);
	syncVault(cfg);
	await sleep(1500);
	await setWindowSize(page, 1280, 900);
	await openNote(page, NOTE, 'reading');
	await sleep(500);
	const text = await page.evaluate((p) => app.vault.read(app.vault.getAbstractFileByPath(p)), NOTE);
	const expected = expectations(text);
	const measure = (doc, win, root) => ({
		rootClass: root.className,
		floats: root.querySelectorAll('p.itw-print-float').length,
		keep: [...root.querySelectorAll('.itw-print-keep-with-next')].filter((e) => /^H\d$/.test(e.tagName)).map((e) => e.textContent),
		breakInside: (() => {
			const p = root.querySelector('p.itw-print-float');
			return p ? win.getComputedStyle(p).breakInside : null;
		})(),
	});
	const result = { expected: expected.length };

	const on = await exportPdf(page, { dest: `${outDir}/page-breaks.pdf`, measure });
	result.withPlugin = { header: on.header, size: on.size, dom: on.result, error: on.error, ...check(pdfPages(on.dest, `${outDir}/page-breaks`), expected) };

	const off = await exportPdf(page, {
		dest: `${outDir}/page-breaks-control.pdf`,
		measure,
		// The control: the same export with the plugin's page-break rules switched off.
		prepare: (doc) => {
			const style = doc.createElement('style');
			style.textContent = '.itw-print-float { break-inside: auto !important; } .itw-print-keep-with-next { break-after: auto !important; }';
			doc.head.appendChild(style);
		},
	});
	result.control = { header: off.header, size: off.size, error: off.error, ...check(pdfPages(off.dest, `${outDir}/page-breaks-control`), expected) };

	// Only the heading rule switched off: shows what keeping a heading with its image adds.
	const noKeep = await exportPdf(page, {
		dest: `${outDir}/page-breaks-no-keep.pdf`,
		measure,
		prepare: (doc) => {
			const style = doc.createElement('style');
			style.textContent = '.itw-print-keep-with-next { break-after: auto !important; }';
			doc.head.appendChild(style);
		},
	});
	result.noKeepWithNext = { header: noKeep.header, ...check(pdfPages(noKeep.dest), expected) };
	result.errors = errors;
	return result;
};
