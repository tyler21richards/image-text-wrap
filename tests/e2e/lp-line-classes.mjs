// Live Preview line classes and the link grammar against what Obsidian really draws.
//   node scripts/obsidian.mjs run tests/e2e/lp-line-classes.mjs
//
// 1. Lines that look like a lone wrapped image link but sit in fenced code, indented code, comments, or
//    are not drawn as an image (nested brackets), keep their height; a real click and ArrowUp inside
//    the code block land on the line above, and typing there shows.
// 2. After a real click inside inline code, inline math or a one-line comment, the "Wrap selected image"
//    command is not offered (its check callback, which decides what the palette lists), and running
//    it changes nothing; a real image on a line with inline code still gets it.
// 3. Tokens with spaces: for each image, selected with a real click, the toolbar's pressed button
//    matches how the picture is drawn (floated left, right, or in line).
// 4. Cost of the line classes per real keystroke in a ~3000-line note (the field's update replayed).
// Scratch notes are written to the instance vault only.
import { clickText, closeLightbox, imageRect, pressed, probe, sleep, sourceNote, state } from './toolbar-helpers.mjs';

const CODE_NOTE = 'ITW line classes.md';
const CODE = [
	'# Syntax note', // 1
	'', // 2
	'Write the layout into the link:', // 3
	'', // 4
	'```markdown', // 5
	'![[photo.png|wrap-left|300]]', // 6
	'![[photo.png|A caption|wrap-right|gap-24|300]]', // 7
	'![A caption|wrap-block|300](photo.png)', // 8
	'more code', // 9
	'```', // 10
	'', // 11
	'    ![[images/square.png|wrap-right|200]]', // 12 indented code
	'', // 13
	'<!--', // 14
	'![[images/square.png|wrap-right|200]]', // 15
	'-->', // 16
	'', // 17
	'![a [b] c|wrap-right](images/square.png)', // 18 Live Preview draws no image
	'', // 19
	'%%', // 20
	'![[images/square.png|wrap-left|200]]', // 21
	'%%', // 22
	'', // 23
	'![[images/square.png|wrap-left|120]]', // 24 the real wrapped image
	'Text beside the real wrapped image. '.repeat(6), // 25
	'', // 26
	'Final paragraph.', // 27
].join('\n');
const KEEP = [6, 7, 8, 12, 15, 18, 21];

const INLINE_NOTE = 'ITW inline code.md';
const INLINE = [
	'# Inline code', // 1
	'', // 2
	'Write `![[square.png|120]]` to embed a picture.', // 3
	'', // 4
	'Double ``![[square.png|120]]`` and math $![[square.png|120]]$ and %%![[square.png|120]]%% here.', // 5
	'', // 6
	'Real `code` then ![[square.png|120]] here.', // 7
	'', // 8
	'End.', // 9
].join('\n');

const SPACED_NOTE = 'ITW spaced tokens.md';
const P = 'Filler text beside the image. The harbour wall was rebuilt three times in the last century.';
const SPACED = [
	['In a sentence ![[square.png| wrap-left |80]] and more.', '![[square.png| wrap-left |80]]'],
	['![[square.png|A caption | wrap-left|90]]', '![[square.png|A caption | wrap-left|90]]'],
	['![[square.png| wrap-left|70]]', '![[square.png| wrap-left|70]]'],
	['![[square.png|wrap-right |70]]', '![[square.png|wrap-right |70]]'],
	['![[square.png|wrap-right ]]', '![[square.png|wrap-right ]]'],
	['Markdown ![ wrap-left |80](images/square.png) inline.', '![ wrap-left |80](images/square.png)'],
	['Control ![[square.png|wrap-left|80]] inline.', '![[square.png|wrap-left|80]]'],
];

const WRAP_LABEL = { left: 'Wrap text left', right: 'Wrap text right', none: 'In line with text' };

export default probe(async (h, check) => {
	const { page } = h;
	const errors = h.watchErrors(page);
	await h.setWindowSize(page, 1280, 900);
	const cm = (fn, arg) => page.evaluate(fn, arg);

	// ---- 1. Lines in code, comments and not-drawn links keep their height ----
	await closeLightbox(page);
	await h.setNote(page, CODE_NOTE, CODE);
	await h.openNote(page, CODE_NOTE, 'live');
	await cm(() => {
		const v = app.workspace.activeLeaf.view.editor.cm;
		v.focus();
		v.dispatch({ selection: { anchor: v.state.doc.length } });
		v.scrollDOM.scrollTop = 0;
	});
	await sleep(600);
	const measure = () =>
		cm((watch) => {
			const v = app.workspace.activeLeaf.view.editor.cm;
			const out = {};
			for (const n of watch) {
				const line = v.state.doc.line(n);
				const { node } = v.domAtPos(line.from);
				const el = (node.nodeType === 1 ? node : node.parentElement).closest('.cm-line');
				out[n] = { cls: el?.className ?? null, height: el ? Math.round(el.getBoundingClientRect().height) : null };
			}
			return out;
		}, [...KEEP, 24]);
	const lines = await measure();
	const collapsed = KEEP.filter((n) => !(lines[n].height > 10) || /itw-image-line/.test(lines[n].cls ?? ''));
	check('lines in code, comments and links Obsidian does not draw keep their height and get no line class', collapsed.length === 0, lines);
	check('the real wrapped image line still gets its class and no height', /itw-image-line-left/.test(lines[24].cls ?? '') && lines[24].height === 0, lines[24]);

	const at = await cm(() => {
		const v = app.workspace.activeLeaf.view.editor.cm;
		const c = v.coordsAtPos(v.state.doc.line(9).from + 4);
		return { x: c.left + 2, y: (c.top + c.bottom) / 2 };
	});
	await page.mouse.click(at.x, at.y);
	await sleep(250);
	await page.keyboard.press('ArrowUp');
	await sleep(150);
	const up = await cm(() => {
		const v = app.workspace.activeLeaf.view.editor.cm;
		return v.state.doc.lineAt(v.state.selection.main.head).number;
	});
	check('ArrowUp from the last code line lands on the line above it', up === 8, { line: up });
	await page.keyboard.press('End');
	await page.keyboard.type(' typed');
	await sleep(300);
	const typed = await cm(() => {
		const v = app.workspace.activeLeaf.view.editor.cm;
		const { node } = v.domAtPos(v.state.doc.line(8).from);
		const el = (node.nodeType === 1 ? node : node.parentElement).closest('.cm-line');
		return { text: v.state.doc.line(8).text, height: Math.round(el.getBoundingClientRect().height) };
	});
	check('typing on that line shows', typed.text.endsWith(' typed') && typed.height > 10, typed);
	await h.setNote(page, CODE_NOTE, CODE);

	// ---- 2. Commands never act on links in inline code, math or comments ----
	await h.setNote(page, INLINE_NOTE, INLINE);
	await h.openNote(page, INLINE_NOTE, 'live');
	await sleep(400);
	const commandAt = async (lineNo, needle, offset) => {
		const p = await cm(
			({ lineNo, needle, offset }) => {
				const v = app.workspace.activeLeaf.view.editor.cm;
				const line = v.state.doc.line(lineNo);
				const c = v.coordsAtPos(line.from + line.text.indexOf(needle) + offset);
				return { x: c.left + 1, y: (c.top + c.bottom) / 2 };
			},
			{ lineNo, needle, offset },
		);
		await page.mouse.click(p.x, p.y);
		await sleep(300);
		return cm(() => {
			const v = app.workspace.activeLeaf.view.editor.cm;
			const before = v.state.doc.toString();
			const cmd = app.commands.findCommand('image-text-wrap:wrap-left');
			const offered = cmd.checkCallback(true) === true;
			if (offered) app.commands.executeCommandById('image-text-wrap:wrap-left');
			const head = v.state.selection.main.head;
			const after = v.state.doc.toString();
			if (after !== before) v.dispatch({ changes: { from: 0, to: after.length, insert: before } });
			return { offered, changed: after !== before, line: v.state.doc.lineAt(head).number, col: head - v.state.doc.lineAt(head).from };
		});
	};
	for (const [name, lineNo, needle, offset] of [
		['inside inline code', 3, '![[square.png|120]]`', 6],
		['on plain text of the same line', 3, 'embed a picture', 3],
		['inside double-backtick code', 5, '![[square.png|120]]``', 6],
		['on a line with inline math and a one-line comment', 5, 'here.', 2],
	]) {
		const r = await commandAt(lineNo, needle, offset);
		check(`"Wrap selected image: left" is not offered ${name}`, !r.offered && !r.changed, r);
	}
	const real = await commandAt(7, 'then', 2);
	check('"Wrap selected image: left" is offered for a real image on a line with inline code', real.offered && real.changed, real);

	// ---- 3. Tokens with spaces: the toolbar agrees with the picture ----
	await h.setNote(page, SPACED_NOTE, ['# Spaced', '', ...SPACED.flatMap(([t]) => [t, P, '']), 'End.'].join('\n'));
	await h.openNote(page, SPACED_NOTE, 'live');
	await sleep(400);
	for (const [, needle] of SPACED) {
		await closeLightbox(page);
		// A real click on the last line lets go of the image selected before (a click on a selected
		// image would open Obsidian's viewer).
		await cm(() => {
			const v = app.workspace.activeLeaf.view.editor.cm;
			v.dispatch({ effects: v.constructor.scrollIntoView(v.state.doc.length, { y: 'center' }) });
		});
		await sleep(250);
		const end = await cm(() => {
			const v = app.workspace.activeLeaf.view.editor.cm;
			const c = v.coordsAtPos(v.state.doc.length);
			return { x: c.left + 2, y: (c.top + c.bottom) / 2 };
		});
		await page.mouse.click(end.x, end.y);
		await sleep(250);
		await cm((needle) => {
			const v = app.workspace.activeLeaf.view.editor.cm;
			v.dispatch({ effects: v.constructor.scrollIntoView(v.state.doc.toString().indexOf(needle), { y: 'center' }) });
		}, needle);
		await sleep(300);
		const r = await imageRect(page, needle);
		if (!r.found) {
			check(`picture drawn for ${needle}`, false, r);
			continue;
		}
		const float = await cm((pos) => {
			const v = app.workspace.activeLeaf.view.editor.cm;
			const e = [...v.contentDOM.querySelectorAll('.image-embed')].find((x) => {
				try {
					return v.posAtDOM(x) === pos;
				} catch {
					return false;
				}
			});
			return getComputedStyle(e).float;
		}, r.pos);
		await page.mouse.click(r.x, r.y);
		await sleep(400);
		const s = await state(page);
		const want = WRAP_LABEL[float] ?? 'In line with text';
		check(`toolbar matches the picture for ${needle}`, s.visible && pressed(s).includes(want), { float, pressed: pressed(s) });
	}
	await closeLightbox(page);
	await clickText(page).catch(() => {});

	// ---- 4. Line classes per real keystroke in a ~3000-line note ----
	const KEYS_NOTE = 'ITW line classes keys.md';
	await h.setNote(page, KEYS_NOTE, Array.from({ length: 25 }, () => sourceNote('Fixture.md')).join('\n'));
	await h.openNote(page, KEYS_NOTE, 'live');
	await sleep(1200);
	const target = await cm(() => {
		const v = app.workspace.activeLeaf.view.editor.cm;
		const doc = v.state.doc;
		let n = Math.floor(doc.lines / 2);
		while (n < doc.lines && !(doc.line(n).text.length > 200 && /^[A-Z]/.test(doc.line(n).text))) n++;
		const line = doc.line(n);
		v.dispatch({ selection: { anchor: line.from }, effects: v.constructor.scrollIntoView(line.from, { y: 'center' }) });
		return { from: line.from, lines: doc.lines };
	});
	await sleep(600);
	const xy = await cm((from) => {
		const c = app.workspace.activeLeaf.view.editor.cm.coordsAtPos(from + 4);
		return { x: c.left + 1, y: (c.top + c.bottom) / 2 };
	}, target.from);
	await page.mouse.click(xy.x, xy.y);
	await sleep(400);
	const hooked = await cm(() => {
		const v = app.workspace.activeLeaf.view.editor.cm;
		const st = v.state;
		const seen = new Set();
		let field = null;
		const walk = (e) => {
			if (field || !e || typeof e !== 'object' || seen.has(e)) return;
			seen.add(e);
			if (typeof e.updateF === 'function' && typeof e.createF === 'function') {
				const value = st.field(e, false);
				if (value && typeof value === 'object' && 'hasWrap' in value && 'decorations' in value) field = e;
				return;
			}
			if (Array.isArray(e)) e.forEach(walk);
			else {
				walk(e.inner);
				walk(e.extension);
			}
		};
		walk(st.config.base);
		if (!field) return false;
		const orig = field.updateF;
		window.__itwLineCalls = [];
		window.__itwLineField = { field, orig };
		field.updateF = (value, tr) => {
			window.__itwLineCalls.push([value, tr]);
			return orig(value, tr);
		};
		return true;
	});
	check('found the line class field in the editor', hooked, null);
	if (hooked) {
		await page.keyboard.type('abcdefghijklmnopqrstuvwxyzabcdefghijklmn', { delay: 30 });
		await sleep(300);
		const cost = await cm(() => {
			const { field, orig } = window.__itwLineField;
			field.updateF = orig;
			const per = window.__itwLineCalls
				.filter(([, tr]) => tr.docChanged)
				.map(([value, tr]) => {
					const t0 = performance.now();
					for (let i = 0; i < 200; i++) orig(value, tr);
					return (performance.now() - t0) / 200;
				})
				.sort((a, b) => a - b);
			const v = app.workspace.activeLeaf.view.editor.cm;
			const list = (set) => {
				const out = [];
				set.between(0, v.state.doc.length, (from, _to, d) => {
					out.push(`${from}:${d.spec.class}`);
				});
				return out.join(',');
			};
			const now = v.state.field(field);
			const fresh = field.createF(v.state);
			return { keystrokes: per.length, medianMs: per[per.length >> 1], maxMs: per[per.length - 1], sameAsFresh: list(now.decorations) === list(fresh.decorations) };
		});
		check(`line classes cost under 0.1 ms per keystroke in a ${target.lines}-line note, and match a fresh build`, cost.keystrokes === 40 && cost.medianMs < 0.1 && cost.sameAsFresh, cost);
		await cm((from) => {
			const v = app.workspace.activeLeaf.view.editor.cm;
			v.dispatch({ changes: { from: from + 4, to: from + 44 } });
		}, target.from);
	}
	check('no console errors', errors.length === 0, errors);
});
