// Draws the two illustrations used in the README screenshot (no dependencies, original artwork).
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const body = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc32(body)); return Buffer.concat([l, body, c]); };
function png(w, h, rgb) {
	const raw = Buffer.alloc((w * 3 + 1) * h);
	for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
	const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
	return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * Math.max(0, Math.min(1, t)));
const hex = (s) => [1, 3, 5].map((i) => parseInt(s.slice(i, i + 2), 16));
// Smooth value noise for ridgelines and texture.
function noise1(seed) { const r = (i) => { const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453; return x - Math.floor(x); }; return (x) => { const i = Math.floor(x), f = x - i, u = f * f * (3 - 2 * f); return r(i) * (1 - u) + r(i + 1) * u; }; }
const fbm = (n, x, oct = 5) => { let v = 0, a = 0.5, f = 1; for (let o = 0; o < oct; o++) { v += a * n(x * f); f *= 2; a *= 0.5; } return v; };

// Renders with 3x3 supersampling: shade(x, y) returns [r,g,b] in 0..255 for a point in image space.
function render(w, h, shade) {
	const out = Buffer.alloc(w * h * 3); const S = 3;
	for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
		let r = 0, g = 0, b = 0;
		for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) { const c = shade(x + (sx + 0.5) / S, y + (sy + 0.5) / S); r += c[0]; g += c[1]; b += c[2]; }
		const o = (y * w + x) * 3; out[o] = r / (S * S); out[o + 1] = g / (S * S); out[o + 2] = b / (S * S);
	}
	return out;
}

// 2D value noise, smooth, for clouds and water.
function noise2(seed) {
	const r = (i, j) => { const x = Math.sin(i * 127.1 + j * 311.7 + seed * 74.7) * 43758.5453; return x - Math.floor(x); };
	return (x, y) => {
		const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
		const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
		const a = r(i, j), b = r(i + 1, j), c = r(i, j + 1), d = r(i + 1, j + 1);
		return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
	};
}
const fbm2 = (n, x, y, oct = 5) => { let v = 0, a = 0.5, f = 1; for (let o = 0; o < oct; o++) { v += a * n(x * f, y * f); f *= 2.03; a *= 0.5; } return v; };
const smooth = (a, b, t) => { const x = Math.max(0, Math.min(1, (t - a) / (b - a))); return x * x * (3 - 2 * x); };

function mountainLake(w, h) {
	const horizon = h * 0.64;
	const ridges = [
		{ n: noise1(1), base: 0.40, amp: 0.30, freq: 2.0, col: hex('#9db3d2') },
		{ n: noise1(2), base: 0.49, amp: 0.20, freq: 3.0, col: hex('#6f8db4') },
		{ n: noise1(3), base: 0.56, amp: 0.12, freq: 4.2, col: hex('#4a6a90') },
		{ n: noise1(4), base: 0.62, amp: 0.06, freq: 7.0, col: hex('#2d4c6c') },
	];
	const ridgeY = (r, x) => h * (r.base - r.amp * fbm(r.n, (x / w) * r.freq));
	const sun = { x: w * 0.70, y: h * 0.17, r: h * 0.055 };
	const clouds = noise2(11);
	const scene = (x, y) => {
		let c = mix(hex('#ffd7a3'), hex('#5e98d6'), Math.pow(1 - y / horizon, 1.1));
		const d = Math.hypot(x - sun.x, y - sun.y);
		c = mix(c, hex('#fff0c8'), Math.exp(-d / (sun.r * 2.2)) * 0.85);
		if (d < sun.r) c = hex('#fff8e4');
		const cl = fbm2(clouds, x / w * 5, y / h * 14);
		c = mix(c, hex('#fdf6ee'), smooth(0.52, 0.75, cl) * smooth(0.45, 0.12, y / h) * 0.75);
		for (const r of ridges) {
			const top = ridgeY(r, x);
			if (y >= top) {
				c = mix(r.col, hex('#1b3149'), ((y - top) / h) * 0.9);
				if (r === ridges[0] && y - top < h * 0.025 * (0.6 + r.n(x / 23))) c = mix(c, hex('#f4f7fb'), 0.8);
			}
		}
		return c;
	};
	const water = noise2(12);
	const pines = noise1(13);
	return render(w, h, (x, y) => {
		let c;
		if (y < horizon) c = scene(x, y);
		else {
			const t = (y - horizon) / (h - horizon);
			const wob = (fbm2(water, x / w * 3, y / h * 40) - 0.5) * 10 * t;
			c = scene(x + wob, horizon - (y - horizon) * 1.05);
			c = mix(c, hex('#214a70'), 0.18 + t * 0.5);
			const glow = Math.exp(-Math.pow((x - sun.x + wob) / (w * 0.035 * (1 + t * 2)), 2));
			const streak = smooth(0.55, 0.8, fbm2(water, x / w * 2, y / h * 60));
			c = mix(c, hex('#ffe7b0'), glow * streak * 0.7);
		}
		// Foreground: a dark shore with a row of pines.
		const shore = h * 0.92 - h * 0.03 * fbm(noise1(9), (x / w) * 5);
		const px = (x / w) * 26, cell = Math.floor(px), fx = px - cell;
		const ph = h * (0.10 + 0.12 * pines(cell * 1.7)), pw = 0.5 * (1 - (shore - y) / ph);
		const tree = y > shore - ph && y < shore + 2 && Math.abs(fx - 0.5) < pw * 0.6 && pines(cell * 3.1) > 0.35;
		if (y > shore || tree) c = mix(hex('#1f3b2d'), hex('#0f2117'), y > shore ? (y - shore) / (h - shore) : 0.2);
		return c;
	});
}

function lighthouse(w, h) {
	const sea = h * 0.70;
	const n = noise1(5);
	const clouds = noise2(21);
	const water = noise2(22);
	const cliff = (x) => h * 0.60 + h * 0.06 * fbm(n, (x / w) * 3) + Math.pow(Math.max(0, x / w - 0.45), 2) * h * 1.6;
	const lx = w * 0.36, lw = w * 0.11, ltop = h * 0.27, lbase = cliff(lx) + 4;
	return render(w, h, (x, y) => {
		let c = mix(hex('#fcd2a2'), hex('#5f95cf'), Math.pow(1 - y / sea, 1.15));
		const cl = fbm2(clouds, x / w * 3.5, y / h * 9);
		c = mix(c, hex('#fffaf2'), smooth(0.5, 0.78, cl) * smooth(0.62, 0.15, y / h) * 0.85);
		// Light beam from the lantern, fading out.
		const dx = x - lx, dy = y - (ltop - h * 0.025);
		const ang = Math.atan2(dy, dx), dist = Math.hypot(dx, dy);
		if (dx < 0) c = mix(c, hex('#fff3c4'), Math.max(0, 1 - Math.abs(ang - Math.PI * 0.955) / 0.06) * Math.max(0, 1 - dist / (w * 0.9)) * 0.55);
		if (y > sea) {
			const t = (y - sea) / (h - sea);
			c = mix(hex('#4a8cc0'), hex('#173d60'), t);
			const glint = smooth(0.62, 0.8, fbm2(water, x / w * 6, y / h * 70));
			c = mix(c, hex('#e3f1ff'), glint * (0.5 - t * 0.3));
		}
		const cy = cliff(x);
		if (y > cy) c = mix(hex('#617150'), hex('#2c3726'), Math.min(1, (y - cy) / (h * 0.35)));
		if (y > cy && y < cy + h * 0.012) c = hex('#86a35d');
		const t = (y - ltop) / (lbase - ltop);
		const half = (lw / 2) * (0.78 + 0.22 * t);
		if (y >= ltop && y <= lbase && Math.abs(x - lx) < half) {
			c = Math.floor(t * 6) % 2 ? hex('#c8463d') : hex('#f4f1ea');
			c = mix(c, hex('#000000'), Math.max(0, (x - lx) / half) * 0.28);
		}
		const lantern = ltop - h * 0.05;
		if (y >= lantern && y < ltop && Math.abs(x - lx) < lw * 0.42) c = Math.abs(x - lx) < lw * 0.3 ? hex('#ffe9a6') : hex('#3a3a3a');
		if (y >= ltop - 4 && y < ltop + 2 && Math.abs(x - lx) < lw * 0.55) c = hex('#2f2f2f');
		if (y >= lantern - h * 0.035 && y < lantern && Math.abs(x - lx) < lw * 0.5 * ((y - (lantern - h * 0.035)) / (h * 0.035))) c = hex('#2c2c2c');
		return c;
	});
}

const out = process.argv[2] ?? 'docs/demo-vault/images';
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'mountain-lake.png'), png(960, 640, mountainLake(960, 640)));
writeFileSync(join(out, 'lighthouse.png'), png(640, 880, lighthouse(640, 880)));
console.log('wrote', out);
