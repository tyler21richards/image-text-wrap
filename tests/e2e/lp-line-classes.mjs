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
// 4. Live Preview, Reading view and the toolbar agree on where a picture wraps: on a line continuing a
//    list item or quote, in a footnote (in line, toolbar not offered), on a line indented by one to
//    three spaces, two on one line, a data-URI image in a sentence (wrapped, the text beside it where
//    Reading view has it, the picture at the column edge, its box no taller than it), and a caption
//    named "constructor" (in line; "Wrap text left" keeps the caption). Real clicks throughout.
// 5. Cost of the line classes per real keystroke in a ~3000-line note (the field's update replayed).
// Scratch notes are written to the instance vault only.
import { clickButton, clickText, closeLightbox, imageRect, pressed, probe, showImage, sleep, sourceNote, state } from './toolbar-helpers.mjs';

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

// Part 4: each case's picture is found by its link (Live Preview) and its width (Reading view); `word`
// starts the text beside it, `want` is how both views draw it, `pressed` the toolbar button shown for it
// (none: the toolbar does not act on it).
const AGREE_NOTE = 'ITW where pictures wrap.md';
const DATA = sourceNote('Fixture.md').match(/data:image\/png;base64,[A-Za-z0-9+/=]+/)[0];
const AGREE_CASES = [
	{ name: 'line continuing a list item', lines: ['- item', '![[square.png|wrap-left|101]]', `LAZYL ${P}`], want: 'none' },
	{ name: 'line continuing a quote', lines: ['> quote', '![[square.png|wrap-left|102]]', `LAZYQ ${P}`], want: 'none' },
	{ name: 'footnote', lines: ['See the note[^1].', '', '[^1]: ![[square.png|wrap-left|103]] Footnote words.'], want: 'none' },
	{ name: 'indented one space', lines: [' ![[square.png|wrap-left|104]]', `INDENTL ${P} ${P}`], want: 'left', pressed: 'Wrap text left' },
	{ name: 'indented three spaces', lines: ['   ![[square.png|wrap-right|105]]', `INDENTR ${P} ${P}`], want: 'right', pressed: 'Wrap text right' },
	{ name: 'two on one line', lines: ['![[square.png|wrap-left|106]] ![[landscape.png|wrap-right|120]]', `TWO ${P} ${P}`], want: 'left', pressed: 'Wrap text left' },
	{ name: 'data-URI image in a sentence', lines: [`DATAS start ![wrap-right|107](${DATA}) ${P} ${P}`], want: 'right', pressed: 'Wrap text right' },
	{ name: 'caption "constructor"', lines: ['![[square.png|constructor|108]]', P], want: 'none', pressed: 'In line with text', click: 'Wrap text left', caption: '|constructor|' },
].map((c) => ({ ...c, link: c.lines.join('\n').match(/!\[[^\n]*?\|(\d+)(?:\]\]|\]\([^)]*\))/)[0], width: c.lines.join('\n').match(/\|(\d+)(?:\]\]|\]\()/)[1], word: c.lines.join(' ').match(/\b[A-Z]{3,}\b/)?.[0] }));
const AGREE = ['# Where pictures wrap', '', ...AGREE_CASES.flatMap((c) => [`## ${c.name}`, '', ...c.lines, '', P, '']), 'End.'].join('\n');

/** In the page: the Live Preview picture whose link starts at `pos`, and the text `word` beside it. */
function lpDrawn({ pos, word }) {
	const v = app.workspace.activeLeaf.view.editor.cm;
	const embed = [...v.contentDOM.querySelectorAll('.image-embed')].find((e) => {
		try {
			return v.posAtDOM(e) === pos;
		} catch {
			return false;
		}
	});
	if (!embed) return null;
	const pic = (embed.querySelector('img') ?? embed).getBoundingClientRect();
	const line = embed.closest('.cm-line');
	const float = getComputedStyle(embed).float;
	const content = [...v.contentDOM.querySelectorAll(':scope > .cm-line')].find((l) => !l.querySelector('.image-embed') && l.textContent.length > 40) ?? line;
	const box = content.getBoundingClientRect();
	const cs = getComputedStyle(content);
	const edge = float === 'right' ? box.right - parseFloat(cs.paddingRight) - pic.right : pic.left - box.left - parseFloat(cs.paddingLeft);
	let textTop = null;
	if (word) {
		const walk = document.createTreeWalker(v.contentDOM, NodeFilter.SHOW_TEXT);
		while (walk.nextNode()) {
			const i = walk.currentNode.textContent.indexOf(word);
			if (i < 0) continue;
			const r = document.createRange();
			r.setStart(walk.currentNode, i);
			r.setEnd(walk.currentNode, i + 1);
			textTop = Math.round(r.getBoundingClientRect().top - pic.top);
			break;
		}
	}
	return { float, cls: line.className.replace(/cm-line|ͼ\w+/g, '').trim(), lineHeight: Math.round(line.getBoundingClientRect().height), edge: Math.round(edge), extra: embed.getBoundingClientRect().height - pic.height, textTop };
}

/** In the page: the Reading view picture `width` wide (scrolling until it is drawn), and the text `word` beside it. */
async function rvDrawn({ width, word }) {
	const root = app.workspace.activeLeaf.view.previewMode.containerEl;
	const scroller = root.querySelector('.markdown-preview-view');
	for (let y = 0; y < 8000; y += 300) {
		const el = root.querySelector(`.image-embed[width="${width}"]`) ?? root.querySelector(`p > img[width="${width}"]`);
		if (el && el.getBoundingClientRect().height > 0) {
			el.scrollIntoView({ block: 'center' });
			await new Promise((r) => setTimeout(r, 200));
			const pic = (el.querySelector('img') ?? el).getBoundingClientRect();
			let textTop = null;
			if (word) {
				const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
				while (walk.nextNode()) {
					const i = walk.currentNode.textContent.indexOf(word);
					if (i < 0) continue;
					const r = document.createRange();
					r.setStart(walk.currentNode, i);
					r.setEnd(walk.currentNode, i + 1);
					textTop = Math.round(r.getBoundingClientRect().top - pic.top);
					break;
				}
			}
			return { float: getComputedStyle(el).float, textTop };
		}
		scroller.scrollTop = y;
		await new Promise((r) => setTimeout(r, 150));
	}
	return null;
}

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

	// ---- 4. Live Preview, Reading view and the toolbar agree on where a picture wraps ----
	await h.setNote(page, AGREE_NOTE, AGREE);
	await h.openNote(page, AGREE_NOTE, 'live');
	await sleep(600);
	const lp = {};
	for (const c of AGREE_CASES) {
		await closeLightbox(page);
		await cm(() => {
			const v = app.workspace.activeLeaf.view.editor.cm;
			v.dispatch({ selection: { anchor: v.state.doc.length }, effects: v.constructor.scrollIntoView(v.state.doc.length, { y: 'center' }) });
		});
		await sleep(250);
		const end = await cm(() => {
			const v = app.workspace.activeLeaf.view.editor.cm;
			const at = v.coordsAtPos(v.state.doc.length);
			return { x: at.left + 2, y: (at.top + at.bottom) / 2 };
		});
		await page.mouse.click(end.x, end.y);
		await sleep(250);
		const r = await showImage(page, c.link);
		const drawn = await cm(lpDrawn, { pos: r.pos, word: c.word });
		if (!r.found || !drawn) {
			check(`${c.name}: picture drawn in Live Preview`, false, r);
			continue;
		}
		// Low on the left of the picture: clear of Obsidian's zoom button (top right) and resize corner.
		await page.mouse.click(r.left + (r.right - r.left) * 0.3, r.top + (r.bottom - r.top) * 0.7);
		await sleep(400);
		const s = await state(page);
		lp[c.name] = { ...drawn, toolbar: s.visible ? pressed(s) : null, spacing: s.buttons.find((b) => /^Spacing/.test(b.label ?? ''))?.disabled ? 'off' : 'on' };
		if (c.click) {
			await clickButton(page, c.click);
			await sleep(300);
			lp[c.name].after = (await cm(() => app.workspace.activeLeaf.view.editor.cm.state.doc.toString())).split('\n').find((l) => l.includes(c.caption));
			await cm((text) => {
				const v = app.workspace.activeLeaf.view.editor.cm;
				v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: text } });
			}, AGREE);
			await sleep(300);
		}
	}
	await closeLightbox(page);
	await cm(() => app.workspace.activeLeaf.view.save());
	await h.openNote(page, AGREE_NOTE, 'reading');
	await sleep(1000);
	const rv = {};
	for (const c of AGREE_CASES) rv[c.name] = await cm(rvDrawn, { width: c.width, word: c.word });
	await h.openNote(page, AGREE_NOTE, 'live');
	for (const c of AGREE_CASES) {
		const l = lp[c.name];
		const r = rv[c.name];
		if (!l) continue;
		const ev = { lp: l, rv: r };
		check(`${c.name}: drawn ${c.want === 'none' ? 'in line' : `wrapped ${c.want}`} in both views`, l.float === c.want && r?.float === c.want, ev);
		check(
			`${c.name}: ${c.pressed ? `the toolbar shows "${c.pressed}" pressed` : 'the toolbar does not act on it'}`,
			c.pressed ? JSON.stringify(l.toolbar) === JSON.stringify([c.pressed]) : l.toolbar === null,
			ev,
		);
		if (c.want === 'none') continue;
		check(`${c.name}: the text beside it starts where it does in Reading view (within 4 px)`, !!r && Math.abs(l.textTop - r.textTop) <= 4, ev);
		check(`${c.name}: the picture sits at the edge of the note column`, Math.abs(l.edge) <= 1, ev);
		check(`${c.name}: its box is no taller than the picture`, Math.abs(l.extra) <= 0.5, ev);
	}
	const caption = lp['caption "constructor"'];
	check('a caption named "constructor": spacing is off, and "Wrap text left" keeps the caption', caption?.spacing === 'off' && caption?.after === '![[square.png|constructor|wrap-left|108]]', caption);

	// ---- 5. Line classes per real keystroke in a ~3000-line note ----
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
