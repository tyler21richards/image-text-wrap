// Brief 7 item 10: Obsidian re-renders only the sections whose text changed, so adding a note's first
// wrap (or removing its last) must restyle every other section of its open Reading views by itself.
//
// 1. Reading view on the right, the same note in Source mode on the left (in Live Preview the image link
//    is a widget the caret cannot enter); real typing adds "|wrap-left" to the only image link, then
//    real Backspaces remove it again.
// 2. Reading view alone; the note is changed through the vault (as the Reading view menu writes it).
// 3. Plugin disabled: no section, attached or not, keeps the class.
//
//   node scripts/obsidian.mjs run tests/e2e/reading-first-wrap.mjs
import { settle } from './reading-measure.mjs';

const NOTE = 'Reading first wrap.md';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function noteText() {
	const para = (n) =>
		Array.from({ length: n }, (_, i) => `Sentence ${i + 1} of a paragraph that is long enough to wrap beside the picture.`).join(' ');
	const filler = Array.from({ length: 30 }, (_, i) => `Filler paragraph ${i + 1}. ${para(4)}`).join('\n\n');
	return `# First wrap

![[landscape.png|300]]
${para(3)}

- A list item beside the image.
	- A nested item.
- Another item.

> A quote whose bar should stay visible.

> [!note] A callout
> Its background should not be covered.

${filler}
`;
}

/** Runs in the page: the state of the Reading view of NOTE. */
function readingState(path) {
	const leaf = app.workspace.getLeavesOfType('markdown').find((l) => l.view.file?.path === path && l.view.getMode() === 'preview');
	if (!leaf) return null;
	const view = leaf.view;
	const sections = view.previewMode.renderer.sections.filter((s) => !s.el.classList.contains('mod-ui'));
	const sizer = view.previewMode.containerEl.querySelector('.markdown-preview-sizer');
	const disp = (sel) => {
		const el = sizer.querySelector(sel);
		return el ? getComputedStyle(el).display : null;
	};
	return {
		sections: sections.length,
		attached: sections.filter((s) => s.el.isConnected).length,
		withClass: sections.filter((s) => s.el.classList.contains('itw-wrap-note')).length,
		detachedWithClass: sections.filter((s) => !s.el.isConnected && s.el.classList.contains('itw-wrap-note')).length,
		ul: disp(':scope > div > ul'),
		blockquote: disp(':scope > div > blockquote'),
		callout: disp('.callout'),
		imgFloat: (() => {
			const e = sizer.querySelector('.image-embed');
			return e ? getComputedStyle(e).float : null;
		})(),
	};
}

export default async ({ page, setNote, getNote, setWindowSize, watchErrors, reloadPlugin, cfg }) => {
	const errors = watchErrors(page);
	await setWindowSize(page, 1280, 900);
	await setNote(page, NOTE, noteText());
	const out = {};
	const state = () => page.evaluate(readingState, NOTE);
	const waitFor = async (pred, ms = 3000) => {
		const t0 = Date.now();
		let s;
		while (Date.now() - t0 < ms) {
			s = await state();
			if (pred(s)) return { ...s, ms: Date.now() - t0 };
			await sleep(50);
		}
		return { ...s, ms: null, timedOut: true };
	};

	// --- 1. Live Preview beside Reading view, real typing ---
	await page.evaluate(async (path) => {
		const file = app.vault.getAbstractFileByPath(path);
		const left = app.workspace.getLeaf(false);
		await left.openFile(file, { state: { mode: 'source', source: true }, active: true });
		const right = app.workspace.getLeaf('split', 'vertical');
		await right.openFile(file, { state: { mode: 'preview' }, active: false });
		app.workspace.setActiveLeaf(left, { focus: true });
	}, NOTE);
	await sleep(800);
	out.before = await state();
	// Put the caret right after "landscape.png" in the editor and type with the keyboard.
	await page.evaluate((path) => {
		const leaf = app.workspace.getLeavesOfType('markdown').find((l) => l.view.file?.path === path && l.view.getMode() === 'source');
		app.workspace.setActiveLeaf(leaf, { focus: true });
		const editor = leaf.view.editor;
		editor.focus();
		editor.setCursor({ line: 2, ch: '![[landscape.png'.length });
	}, NOTE);
	await sleep(200);
	const editorLine = () =>
		page.evaluate((path) => {
			const leaf = app.workspace.getLeavesOfType('markdown').find((l) => l.view.file?.path === path && l.view.getMode() === 'source');
			return leaf.view.editor.getLine(2);
		}, NOTE);
	await page.keyboard.type('|wrap-left', { delay: 30 });
	out.afterTypingText = await editorLine();
	out.firstWrapAdded = await waitFor((s) => s.withClass === s.sections && s.ul === 'flow-root' && s.imgFloat === 'left');
	for (let i = 0; i < '|wrap-left'.length; i++) await page.keyboard.press('Backspace');
	out.afterDeleteText = await editorLine();
	out.lastWrapRemoved = await waitFor((s) => s.withClass === 0 && s.ul === 'block' && s.imgFloat === 'none');
	await page.evaluate((path) => {
		const leaf = app.workspace.getLeavesOfType('markdown').find((l) => l.view.file?.path === path && l.view.getMode() === 'source');
		return leaf.view.save();
	}, NOTE);

	// --- 1b. One pane: edit in Live Preview, then switch it to Reading view (the usual way) ---
	await page.evaluate((path) => {
		for (const leaf of app.workspace.getLeavesOfType('markdown')) {
			if (leaf.view.file?.path === path && leaf.view.getMode() === 'source') leaf.detach();
		}
	}, NOTE);
	await sleep(400);
	const switchMode = (mode) =>
		page.evaluate(async (mode) => {
			const leaf = app.workspace.activeLeaf;
			await leaf.setViewState({ ...leaf.getViewState(), state: { ...leaf.getViewState().state, mode, source: false } });
		}, mode);
	const editInEditor = (from, to) =>
		page.evaluate(
			({ from, to }) => {
				const editor = app.workspace.activeLeaf.view.editor;
				const line = editor.getLine(2);
				editor.setLine(2, line.replace(from, to));
			},
			{ from, to },
		);
	await page.evaluate((path) => app.workspace.setActiveLeaf(app.workspace.getLeavesOfType('markdown').find((l) => l.view.file?.path === path), { focus: true }), NOTE);
	out.samePaneBefore = await state();
	await switchMode('source');
	await sleep(300);
	await editInEditor('|300', '|wrap-left|300');
	await switchMode('preview');
	out.samePaneFirstWrap = await waitFor((s) => s.withClass === s.sections && s.ul === 'flow-root' && s.imgFloat === 'left');
	await switchMode('source');
	await sleep(300);
	await editInEditor('|wrap-left|300', '|300');
	await switchMode('preview');
	out.samePaneLastWrap = await waitFor((s) => s.withClass === 0 && s.ul === 'block' && s.imgFloat === 'none');
	await page.evaluate(() => app.workspace.activeLeaf.view.save());
	await sleep(300);

	// --- 2. Reading view alone, change written through the vault ---
	await page.evaluate(async (path) => {
		const file = app.vault.getAbstractFileByPath(path);
		await app.vault.process(file, (d) => d.replace('![[landscape.png|300]]', '![[landscape.png|wrap-right|300]]'));
	}, NOTE);
	out.vaultFirstWrap = await waitFor((s) => s.withClass === s.sections && s.blockquote === 'flow-root' && s.imgFloat === 'right');
	await page.evaluate(async (path) => {
		const file = app.vault.getAbstractFileByPath(path);
		await app.vault.process(file, (d) => d.replace('|wrap-right|300', '|300'));
	}, NOTE);
	out.vaultLastWrap = await waitFor((s) => s.withClass === 0 && s.blockquote === 'block' && s.imgFloat === 'none');

	// --- 3. Unload: wrap on, then disable the plugin ---
	await page.evaluate(async (path) => {
		const file = app.vault.getAbstractFileByPath(path);
		await app.vault.process(file, (d) => d.replace('|300]]', '|wrap-left|300]]'));
	}, NOTE);
	out.beforeDisable = await waitFor((s) => s.withClass === s.sections);
	await page.evaluate(() => app.plugins.disablePlugin('image-text-wrap'));
	await sleep(300);
	out.afterDisable = await state();
	out.afterDisable.anyClassInDocument = await page.evaluate(() => document.querySelectorAll('.itw-wrap-note').length);
	await reloadPlugin(page, cfg);
	await sleep(300);
	out.afterReEnable = await state();

	// Tidy up: one leaf, the note restored.
	await page.evaluate((path) => {
		const leaves = app.workspace.getLeavesOfType('markdown');
		leaves.slice(1).forEach((l) => l.detach());
	}, NOTE);
	await setNote(page, NOTE, noteText());
	await settle(page);
	out.errors = errors;
	return out;
};
