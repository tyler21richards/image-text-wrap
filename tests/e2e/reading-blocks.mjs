// Brief 7 items 7-8: headings, lists (nested), quotes, callouts, tables, code, display math and rules
// beside a wrapped image, in Reading view and in the PDF export.
//
// Reading view: no block box may run under the image (a quote bar, a callout background, a code or table
// box drawn under it would be covered), no text line may reach under it, and nested list items must keep
// their indent. PDF: no drawn shape (quote bar, callout or code background, table border, list bullet)
// may overlap an image. The PDF is exported twice: as is, and with the plugin's block fixes switched off
// in the print window (the control).
//
//   node scripts/obsidian.mjs run tests/e2e/reading-blocks.mjs <outDir>
import { exportPdf } from './pdf-export.mjs';
import { pdfPages } from './pdf-pages.mjs';
import { measureInView, settle } from './reading-measure.mjs';

const NOTE = 'Reading beside blocks.md';

const TEXT = `# Blocks beside a wrapped image

![[tall.png|wrap-left|300]]
A short paragraph that starts beside the image.

## A heading beside the image

- A list item beside the image.
	- A nested item, one level in.
		- A nested item, two levels in.
- Back to the first level.

> A quote whose bar must stay visible beside the image.

> [!note] A callout
> Its background must not be covered by the image.

Text between the blocks, long enough to run to a second line beside the picture so the wrap shows.

![[tall.png|wrap-right|300]]
Another short paragraph, this time beside an image on the right.

| Place | Note |
| --- | --- |
| Harbour | A table beside the image |
| Lighthouse | Its border should not run under it |

\`\`\`js
// A code block beside the image.
const tide = (hour) => Math.sin(hour);
\`\`\`

$$
h(t) = A \\sin\\left(\\frac{2\\pi t}{T}\\right)
$$

---

1. A numbered list beside the image.
2. Its numbers must stay visible.

Some closing text after the rule, which also sits beside the picture until the picture ends.

${Array.from({ length: 8 }, (_, i) => `Filler paragraph ${i + 1} after the images, so the note continues below them.`).join('\n\n')}
`;

/** Shapes drawn in the PDF that overlap an image on the same page. */
function overlaps(pages) {
	const out = [];
	for (const p of pages) {
		for (const img of p.images) {
			for (const d of p.drawings) {
				const ix = Math.min(d.x1, img.x1) - Math.max(d.x0, img.x0);
				const iy = Math.min(d.y1, img.y1) - Math.max(d.y0, img.y0);
				if (ix > 1 && iy > 1) out.push({ page: p.page, image: img, shape: d });
			}
		}
	}
	return out;
}

export default async ({ page, args, setNote, openNote, setWindowSize, watchErrors }) => {
	const outDir = args[0];
	if (!outDir) throw new Error('usage: reading-blocks.mjs <outDir>');
	const errors = watchErrors(page);
	await setWindowSize(page, 1280, 900);
	await setNote(page, NOTE, TEXT);
	await openNote(page, NOTE, 'reading');
	await settle(page, 500);
	const result = {};

	// Reading view: both images, each scrolled into view.
	result.reading = [];
	for (const line of [2, 19]) {
		await page.evaluate((n) => app.workspace.activeLeaf.view.previewMode.applyScroll(n), line);
		await settle(page, 300);
		const m = await measureInView(page, 'reading');
		const found = m.find((x) => x.side === (line === 2 ? 'left' : 'right'));
		result.reading.push(found);
		if (found) {
			const column = await page.evaluate(() => {
				const r = app.workspace.activeLeaf.view.containerEl.querySelector('.markdown-reading-view .markdown-preview-sizer').getBoundingClientRect();
				return { l: r.left, w: r.width };
			});
			await page.screenshot({
				path: `${outDir}/reading-blocks-${found.side}.png`,
				clip: { x: column.l - 30, y: Math.max(0, found.img.t - 50), width: column.w + 60, height: Math.min(found.img.h + 100, 840) },
			});
		}
	}
	// Nested list indent beside the left image vs. the same list with the image's float switched off.
	result.listIndent = await page.evaluate(async () => {
		const sizer = app.workspace.activeLeaf.view.containerEl.querySelector('.markdown-reading-view .markdown-preview-sizer');
		const ul = sizer.querySelector(':scope > div > ul');
		if (!ul) return null;
		const lefts = () => [...ul.querySelectorAll('li')].map((li) => Math.round(li.getBoundingClientRect().left - ul.getBoundingClientRect().left));
		const beside = lefts();
		return { beside, ulLeft: Math.round(ul.getBoundingClientRect().left), imageRight: Math.round(sizer.querySelector('.image-embed').getBoundingClientRect().right) };
	});

	const blockFixesOff = (doc) => {
		const style = doc.createElement('style');
		style.textContent = '.itw-wrap-note :is(ul, ol, blockquote, .callout, hr, .math-block) { display: block !important; }';
		doc.head.appendChild(style);
	};
	for (const [name, prepare] of [['pdf', null], ['control', blockFixesOff]]) {
		const res = await exportPdf(page, { dest: `${outDir}/blocks-${name}.pdf`, prepare: prepare ?? undefined });
		const pages = pdfPages(res.dest, `${outDir}/blocks-${name}`);
		const o = overlaps(pages);
		result[name] = {
			header: res.header,
			pages: pages.length,
			images: pages.flatMap((p) => p.images.map((i) => ({ page: p.page, ...i }))),
			overlappingShapes: o.length,
			overlaps: o.slice(0, 12).map((x) => ({ page: x.page, shape: x.shape })),
		};
	}
	result.errors = errors;
	return result;
};
