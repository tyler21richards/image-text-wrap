// Reads an exported PDF page by page: image boxes, text line boxes, and optional PNG renders.
// Needs a python3 with PyMuPDF (`import pymupdf`); the idea of comparing PDF geometry this way comes
// from Adjustable Media (docs/plans/layout-redesign/probes/w07-final-pdf-compare.py, MIT).
//
//   node tests/e2e/pdf-pages.mjs <file.pdf> [pngPrefix]
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT = String.raw`
import json, sys
import pymupdf
doc = pymupdf.open(sys.argv[1])
prefix = sys.argv[2] if len(sys.argv) > 2 else ''
pages = []
for n, page in enumerate(doc):
    d = page.get_text('dict')
    images, lines = [], []
    for b in d['blocks']:
        if b['type'] == 1:
            x0, y0, x1, y1 = b['bbox']
            images.append({'x0': round(x0, 1), 'y0': round(y0, 1), 'x1': round(x1, 1), 'y1': round(y1, 1), 'w': b.get('width'), 'h': b.get('height')})
        else:
            for l in b['lines']:
                text = ''.join(s['text'] for s in l['spans']).strip()
                if not text:
                    continue
                x0, y0, x1, y1 = l['bbox']
                lines.append({'x0': round(x0, 1), 'y0': round(y0, 1), 'x1': round(x1, 1), 'y1': round(y1, 1), 'text': text[:60]})
    # Images drawn with transforms are not always text-dict blocks; also list placed images.
    placed = []
    for info in page.get_image_info():
        x0, y0, x1, y1 = info['bbox']
        placed.append({'x0': round(x0, 1), 'y0': round(y0, 1), 'x1': round(x1, 1), 'y1': round(y1, 1)})
    if prefix:
        page.get_pixmap(dpi=60).save(f'{prefix}-p{n + 1}.png')
    # Filled shapes and strokes (quote bars, callout backgrounds, code backgrounds, table borders, bullets).
    drawings = []
    for d in page.get_drawings():
        r = d.get('rect')
        if r is None or (r.width < 0.1 and r.height < 0.1):
            continue
        drawings.append({'x0': round(r.x0, 1), 'y0': round(r.y0, 1), 'x1': round(r.x1, 1), 'y1': round(r.y1, 1),
                         'fill': d.get('fill'), 'color': d.get('color'), 'type': d.get('type')})
    pages.append({'page': n + 1, 'width': page.rect.width, 'height': page.rect.height, 'images': placed or images, 'lines': lines, 'drawings': drawings})
print(json.dumps(pages))
`;

export function pdfPages(file, pngPrefix = '') {
	const run = spawnSync('python3', ['-I', '-c', SCRIPT, file, pngPrefix], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
	if (run.status !== 0) throw new Error(`PyMuPDF failed: ${run.stderr}`);
	return JSON.parse(run.stdout);
}

const CLIP_SCRIPT = String.raw`
import json, sys
import pymupdf
doc = pymupdf.open(sys.argv[1])
for c in json.loads(sys.argv[2]):
    page = doc[c['page'] - 1]
    r = pymupdf.Rect(0, max(0, c['y0']), page.rect.width, min(page.rect.height, c['y1']))
    page.get_pixmap(dpi=96, clip=r).save(c['out'])
`;

/** Renders page regions at 96 dpi (1 PDF pt = 4/3 CSS px): clips = [{ page, y0, y1 (pt), out }]. */
export function renderClips(file, clips) {
	const run = spawnSync('python3', ['-I', '-c', CLIP_SCRIPT, file, JSON.stringify(clips)], { encoding: 'utf8' });
	if (run.status !== 0) throw new Error(`PyMuPDF failed: ${run.stderr}`);
}

const PX = 96 / 72;

/**
 * For each image on each page: which side it sits on, the first text line beside it and how far the
 * image top is from that line's top (in CSS px), and whether it has any text beside it on its page.
 * An image whose box spans the middle of the text column is centred (top and bottom), not wrapped.
 */
export function wrapsInPdf(pages) {
	const out = [];
	for (const p of pages) {
		const left = Math.min(...p.lines.map((l) => l.x0), ...p.images.map((i) => i.x0));
		const right = Math.max(...p.lines.map((l) => l.x1), ...p.images.map((i) => i.x1));
		for (const img of p.images) {
			const side = Math.abs(img.x0 - left) < 2 ? 'left' : Math.abs(img.x1 - right) < 2 ? 'right' : 'centre';
			const beside = p.lines.filter(
				(l) => l.y1 > img.y0 + 1 && l.y0 < img.y1 - 1 && (side === 'left' ? l.x0 >= img.x1 : side === 'right' ? l.x1 <= img.x0 : false),
			);
			const first = [...beside].sort((a, b) => a.y0 - b.y0)[0];
			out.push({
				page: p.page,
				side,
				w: Math.round((img.x1 - img.x0) * PX),
				h: Math.round((img.y1 - img.y0) * PX),
				topPx: Math.round(img.y0 * PX * 10) / 10,
				bottomPx: Math.round(img.y1 * PX * 10) / 10,
				pageHeightPx: Math.round(p.height * PX),
				beside: beside.length,
				firstLine: first?.text ?? null,
				topVsGlyph: first ? Math.round((img.y0 - first.y0) * PX * 10) / 10 : null,
				gapPx: first ? Math.round((side === 'left' ? first.x0 - img.x1 : img.x0 - first.x1) * PX * 10) / 10 : null,
			});
		}
	}
	return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const pages = pdfPages(process.argv[2], process.argv[3] ?? '');
	for (const p of pages) {
		console.log(
			`page ${p.page}: ${p.images.length} images ${JSON.stringify(p.images)}; ${p.lines.length} lines, first "${p.lines[0]?.text ?? ''}" last "${p.lines[p.lines.length - 1]?.text ?? ''}"`,
		);
	}
}
