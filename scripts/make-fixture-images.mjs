// Writes the PNG test images used by the fixture note. No dependencies: a tiny PNG encoder on top of zlib.
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});
const crc32 = (buf) => {
	let c = 0xffffffff;
	for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([len, body, crc]);
};

function png(width, height, pixel) {
	const raw = Buffer.alloc((width * 3 + 1) * height);
	for (let y = 0; y < height; y++) {
		raw[y * (width * 3 + 1)] = 0;
		for (let x = 0; x < width; x++) {
			const [r, g, b] = pixel(x, y);
			const o = y * (width * 3 + 1) + 1 + x * 3;
			raw[o] = r; raw[o + 1] = g; raw[o + 2] = b;
		}
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw)),
		chunk('IEND', Buffer.alloc(0)),
	]);
}

const lerp = (a, b, t) => Math.round(a + (b - a) * t);
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];

// Gradient with a centred disc and a 1px border, so edges and alignment are easy to see in screenshots.
function picture(w, h, top, bottom, disc) {
	return png(w, h, (x, y) => {
		if (x === 0 || y === 0 || x === w - 1 || y === h - 1) return [40, 40, 40];
		const dx = x - w / 2, dy = y - h / 2, r = Math.min(w, h) / 4;
		if (dx * dx + dy * dy < r * r) return disc;
		return mix(top, bottom, y / h);
	});
}

const out = process.argv[2] ?? 'test-vault/images';
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'landscape.png'), picture(640, 420, [120, 180, 230], [30, 90, 160], [250, 210, 80]));
writeFileSync(join(out, 'tall.png'), picture(400, 900, [170, 220, 160], [40, 110, 70], [240, 120, 90]));
writeFileSync(join(out, 'square.png'), picture(300, 300, [230, 170, 200], [140, 60, 120], [255, 255, 255]));
console.log('wrote images to', out);
