// Writes "PDF page breaks.md", a long note whose wrapped images fall at many different heights on the
// page, so that several of them meet a page break when the note is exported to PDF (brief M4).
// Usage: node scripts/make-page-breaks.mjs [vaultDir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const vault = process.argv[2] ?? 'test-vault';
mkdirSync(vault, { recursive: true });

const POOL = [
	'The tide came in early that morning and covered the lower steps of the harbour.',
	'A fishing boat with a red hull was tied up beside the old crane.',
	'Somebody had chalked the times of the ferries on the wall of the ticket office.',
	'Two gulls argued over a crust of bread on the roof of the fish market.',
	'The lighthouse was painted white with a single black band near the top.',
	'In the afternoon the wind dropped and the water turned the colour of slate.',
	'Children ran along the sea wall, counting the boats as they came home.',
	'The baker left a tray of rolls to cool on the sill of the open window.',
	'A narrow lane climbed from the quay to the church between high stone walls.',
	'By evening the lamps along the front were lit one after another.',
	'An old map in the library shows the coastline as it was two centuries ago.',
];

let cursor = 0;
function paragraph(sentences) {
	const out = [];
	for (let i = 0; i < sentences; i++) {
		out.push(POOL[cursor % POOL.length]);
		cursor += 3;
	}
	return out.join(' ');
}

const images = [
	{ link: '![[tall.png|wrap-right|200]]', heading: true },
	{ link: '![[landscape.png|wrap-left|320]]', heading: false },
	{ link: '![[square.png|wrap-right|220]]', heading: true, list: true },
	{ link: '![[tall.png|A tall picture|wrap-left|180]]', heading: true },
	{ link: '![[landscape.png|wrap-right|280]]', heading: false, short: true },
	{ link: '![[square.png|wrap-left|200]]', heading: true },
	{ link: '![[tall.png|wrap-right|220]]', heading: false, short: true },
	{ link: '![[landscape.png|wrap-left|300]]', heading: true, list: true },
	{ link: '![[square.png|wrap-right|240]]', heading: true },
	{ link: '![[tall.png|wrap-left|200]]', heading: false },
	{ link: '![[landscape.png|wrap-right|320]]', heading: true, short: true },
	{ link: '![[square.png|wrap-left|180]]', heading: false },
];

const parts = [
	'# PDF page breaks',
	'',
	'Each section below has a wrapped image at a different height on the page. Export this note to PDF and check that no image is cut in two, and that no image sits on a page apart from the text it wraps.',
	'',
];
images.forEach((img, i) => {
	// Filler of varying length shifts the next image to a new height on the page.
	for (let p = 0; p < 1 + (i % 3); p++) parts.push(paragraph(3 + ((i * 2 + p) % 5)), '');
	if (img.heading) parts.push(`## Section ${i + 1}`, '');
	parts.push(img.link, paragraph(img.short ? 2 : 5));
	parts.push('');
	if (img.list) parts.push('- A list item beside the image.', '\t- A nested item.', '- Another item.', '');
	parts.push(paragraph(4), '');
});
// A sweep: every section has a heading, and the filler before it grows by one sentence each time, so
// some heading lands at the foot of a page with no room left for its image under it.
const sweep = ['![[tall.png|wrap-left|160]]', '![[landscape.png|wrap-right|260]]', '![[square.png|wrap-left|160]]'];
for (let k = 0; k < 16; k++) {
	const i = images.length + k;
	parts.push(paragraph(2 + k), '');
	parts.push(`## Section ${i + 1}`, '');
	parts.push(sweep[k % sweep.length], paragraph(3), '');
}
parts.push(paragraph(6), '');

writeFileSync(join(vault, 'PDF page breaks.md'), parts.join('\n'));
console.log('wrote', join(vault, 'PDF page breaks.md'));
