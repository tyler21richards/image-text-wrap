// Geometry of wrapped images and the text beside them, the same way in Live Preview, Reading view and
// the PDF print window. `measureWraps` is self-contained (it only uses its arguments) so it can be sent
// as source into the print window.
//
// The text-line method (Range.getClientRects over text nodes, glyph box vs line box) follows
// Adjustable Media (probes/w07-final-geometry.js.txt, textTop) and image-rows-and-wraps
// (tests/obsidian.mjs, line-box wrap assertion), both MIT.

/**
 * @param doc   document to measure in
 * @param win   its window
 * @param root  .cm-content (Live Preview), .markdown-preview-sizer (Reading) or the print root
 * @param only  optional index list: measure only these wrapped images (by order in root)
 */
export function measureWraps(doc, win, root, only = null) {
	const r1 = (n) => Math.round(n * 10) / 10;
	const box = (r) => ({ l: r1(r.left), t: r1(r.top), r: r1(r.right), b: r1(r.bottom), w: r1(r.width), h: r1(r.height) });
	const SKIP = '.image-embed, .embed-actions, .edit-block-button, .image-resize-corner, .cm-widgetBuffer, .collapse-indicator, .list-bullet, .copy-code-button, .callout-icon, .heading-collapse-indicator, .frontmatter-container, .mod-ui, .inline-title';
	const floats = [];
	for (const el of root.querySelectorAll('.image-embed, p > img')) {
		const cs = win.getComputedStyle(el);
		if (cs.float !== 'left' && cs.float !== 'right') continue;
		if (el.closest('.markdown-embed')) continue; // a transcluded note's image: reported apart
		floats.push(el);
	}
	const lines = [];
	const walker = doc.createTreeWalker(root, win.NodeFilter.SHOW_TEXT);
	for (let n; (n = walker.nextNode()); ) {
		if (!n.textContent.trim()) continue;
		const parent = n.parentElement;
		if (!parent || parent.closest(SKIP)) continue;
		const range = doc.createRange();
		range.selectNodeContents(n);
		const lh = parseFloat(win.getComputedStyle(parent).lineHeight);
		for (const b of range.getClientRects()) {
			if (b.width < 1 || b.height < 1) continue;
			const half = Number.isFinite(lh) ? (lh - b.height) / 2 : 0;
			lines.push({ l: b.left, r: b.right, t: b.top, b: b.bottom, lineTop: b.top - half, text: n.textContent.slice(0, 24), parent });
		}
	}
	const BLOCKS = 'ul, ol, blockquote, .callout, hr, .math-block, table, pre, h1, h2, h3, h4, h5, h6';
	const out = [];
	floats.forEach((el, index) => {
		if (only && !only.includes(index)) return;
		const img = el.tagName === 'IMG' ? el : el.querySelector('img');
		if (!img) return;
		const ir = img.getBoundingClientRect();
		const er = el.getBoundingClientRect();
		const side = win.getComputedStyle(el).float;
		const gap = side === 'left' ? parseFloat(win.getComputedStyle(el).marginRight) : parseFloat(win.getComputedStyle(el).marginLeft);
		const beside = lines.filter((b) => b.b > ir.top + 1 && b.t < ir.bottom - 1 && (side === 'left' ? b.l >= ir.left : b.r <= ir.right));
		const intrude = beside.filter((b) => (side === 'left' ? b.l < ir.right + gap - 1 : b.r > ir.left - gap + 1));
		const sorted = [...beside].sort((a, b) => a.t - b.t);
		const first = sorted[0];
		const blocks = [];
		for (const bl of root.querySelectorAll(BLOCKS)) {
			if (bl.closest('.markdown-embed') && !el.closest('.markdown-embed')) continue;
			if (bl.parentElement?.closest('ul, ol, blockquote, .callout, table')) continue; // outermost only
			const br = bl.getBoundingClientRect();
			if (br.height < 1 || br.bottom <= ir.top + 1 || br.top >= ir.bottom - 1) continue;
			const overlapX = side === 'left' ? br.left < ir.right + gap - 1 : br.right > ir.left - gap + 1;
			const cs = win.getComputedStyle(bl);
			const info = {
				tag: bl.tagName.toLowerCase() + (bl.classList.contains('callout') ? '.callout' : '') + (bl.classList.contains('math-block') ? '.math' : ''),
				box: box(br),
				display: cs.display,
				coversImage: overlapX,
			};
			if (bl.tagName === 'UL' || bl.tagName === 'OL') {
				info.itemLefts = [...bl.querySelectorAll('li')].map((li) => r1(li.getBoundingClientRect().left));
			}
			blocks.push(info);
		}
		out.push({
			index,
			alt: el.getAttribute('alt') ?? img.getAttribute('alt'),
			src: (el.getAttribute('src') ?? img.getAttribute('src') ?? '').slice(0, 40),
			side,
			gap,
			embed: box(er),
			img: box(ir),
			beside: beside.length,
			intrude: intrude.length,
			firstLine: first ? { text: first.text, glyphTop: r1(first.t), lineTop: r1(first.lineTop) } : null,
			topVsGlyph: first ? r1(ir.top - first.t) : null,
			topVsLineBox: first ? r1(ir.top - first.lineTop) : null,
			firstLineLeft: first ? r1(side === 'left' ? first.l - ir.right : ir.left - first.r) : null,
			blocks,
		});
	});
	return out;
}

/** Top of the first text node starting with each of `texts`, relative to `refTop` (glyph box, px). */
export function textOffsets(doc, win, root, refTop, texts) {
	const out = {};
	const walker = doc.createTreeWalker(root, win.NodeFilter.SHOW_TEXT);
	for (let n; (n = walker.nextNode()); ) {
		const t = n.textContent.trimStart();
		for (const want of texts) {
			if (want in out || !t.startsWith(want)) continue;
			const range = doc.createRange();
			range.selectNodeContents(n);
			const r = range.getClientRects()[0];
			if (r) out[want] = Math.round((r.top - refTop) * 10) / 10;
		}
	}
	return out;
}

/** Runs measureWraps in the vault window for the active leaf. mode: 'live' | 'reading'. */
export async function measureInView(page, mode, only = null) {
	return page.evaluate(
		({ src, mode, only }) => {
			const fn = new Function(`return (${src})`)();
			const leafEl = app.workspace.activeLeaf.view.containerEl;
			// The note's own sizer, not the one of a transcluded note or of an embed in the editor.
			const root = [...leafEl.querySelectorAll(mode === 'live' ? '.cm-content' : '.markdown-preview-sizer')].find(
				(el) => !el.closest('.markdown-embed') && (mode === 'live' || !el.closest('.markdown-source-view')),
			);
			return fn(document, window, root, only);
		},
		{ src: measureWraps.toString(), mode, only },
	);
}

/** Wait two animation frames plus `ms`, so layout and Obsidian's virtual rendering settle. */
export async function settle(page, ms = 60) {
	await page.evaluate(
		(ms) => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, ms)))),
		ms,
	);
}
