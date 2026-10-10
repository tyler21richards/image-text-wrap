// Reading view and PDF export (brief 6.4, 7 items 7-10). Display only: no toolbar, no dragging.
//
// Rendering stays in styles.css, which reads the layout tokens from each image's alt attribute. This
// module only marks the sections of notes that have an image wrapped left or right with itw-wrap-note,
// which scopes the fixes for blocks beside a float (quote bars, callout backgrounds, nested lists), and
// prepares PDF exports (print.ts). It also keeps text wrapped while Obsidian has taken an image's own
// section off the page (stand-ins.ts).
//
// Obsidian re-renders only the sections whose text changed, so adding a note's first wrap (or removing
// its last) would leave every other section with the old class. Whenever the answer changes for a
// note, every section of its open Reading views is updated (sections.ts). The approach follows
// Adjustable Media (src/view/readingView.ts, markWrapping), MIT, (c) 2026 Yi-luo-hua.
import { MarkdownView, debounce, type Editor, type MarkdownPostProcessorContext } from 'obsidian';
import { isPrintRoot } from '../dom';
import type ImageTextWrapPlugin from '../main';
import { WRAP_NOTE_CLASS, preparePrint } from './print';
import { allSectionEls, attachedSectionEls } from './sections';
import { StandIns } from './stand-ins';
import { embedHasFloat, textHasFloat } from './wraps';

export { WRAP_NOTE_CLASS } from './print';

const MEMO_SIZE = 8;
const EDIT_CHECK_MS = 120;

export function registerReadingView(plugin: ImageTextWrapPlugin): void {
	const { app } = plugin;
	/** Per note path: whether it has a floating image, as last applied to its open Reading views. */
	const known = new Map<string, boolean>();
	/** Per note path: the last text checked and its answer, so repeated checks of one text are free. */
	const memo = new Map<string, { text: string; has: boolean }>();
	const pendingRerenders = new Map<MarkdownView, number>();
	const standIns = new StandIns();
	let unloaded = false;

	const viewsOf = (path: string): MarkdownView[] => {
		const out: MarkdownView[] = [];
		app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file?.path === path) out.push(view);
		});
		return out;
	};

	const textDecides = (path: string, text: string): boolean => {
		const last = memo.get(path);
		if (last && last.text === text) return last.has;
		const has = textHasFloat(text);
		memo.delete(path);
		memo.set(path, { text, has });
		// Keep only the notes worked on recently.
		if (memo.size > MEMO_SIZE) memo.delete(memo.keys().next().value!);
		return has;
	};

	/**
	 * Whether the note at `path` has a floating image. `text` is the note's text when the caller has it
	 * (a section's info holds the whole note, except for some sections, such as math, where it is empty).
	 * Otherwise an open view's text, otherwise the links Obsidian's metadata cache found in the note.
	 */
	const decide = (path: string, text?: string | null): boolean => {
		if (text) return textDecides(path, text);
		const view = viewsOf(path)[0];
		if (view) return textDecides(path, view.getViewData());
		const embeds = app.metadataCache.getCache(path)?.embeds ?? [];
		return embeds.some((embed) => embedHasFloat(embed.original));
	};

	const rerenderLater = (view: MarkdownView) => {
		if (pendingRerenders.has(view)) return;
		const win = view.containerEl.win;
		const timer = win.setTimeout(() => {
			pendingRerenders.delete(view);
			if (!unloaded) view.previewMode.rerender(true);
		}, 0);
		pendingRerenders.set(view, timer);
	};

	const markView = (view: MarkdownView, has: boolean) => {
		const all = allSectionEls(view);
		for (const el of all ?? attachedSectionEls(view)) el.toggleClass(WRAP_NOTE_CLASS, has);
		// Sections off the page cannot be reached without the renderer's list: render them again.
		if (!all) rerenderLater(view);
		if (has) standIns.watch(view);
		else standIns.unwatch(view);
	};

	/** Records the answer for a note and, when it changed, restyles every section of its open views. */
	const update = (path: string, has: boolean) => {
		if (known.get(path) === has) return;
		known.set(path, has);
		for (const view of viewsOf(path)) markView(view, has);
	};

	plugin.registerMarkdownPostProcessor((el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
		const info = ctx.getSectionInfo(el);
		if (!info) {
			// No section: a PDF export's root, or something rendered inside the editor (a callout or
			// table in Live Preview), which is not ours to restyle.
			if (isPrintRoot(el)) preparePrint(plugin, el, decide(ctx.sourcePath));
			return;
		}
		const has = decide(ctx.sourcePath, info.text);
		el.toggleClass(WRAP_NOTE_CLASS, has);
		update(ctx.sourcePath, has);
		// A new or re-rendered section may change which sections an image reaches.
		if (has) for (const view of viewsOf(ctx.sourcePath)) standIns.watch(view);
	});

	// Typing in an editor: the fastest signal, but only worth reading the note when it is also open
	// in Reading view somewhere (the same pane in editing mode is handled when it switches back).
	// Checked once typing pauses, so a long note is not scanned on every keystroke.
	const edited = new Map<string, Editor>();
	const checkEdits = debounce(
		() => {
			for (const [path, editor] of edited) update(path, textDecides(path, editor.getValue()));
			edited.clear();
		},
		EDIT_CHECK_MS,
		true,
	);
	plugin.registerEvent(
		app.workspace.on('editor-change', (editor, info) => {
			const path = info.file?.path;
			if (!path || unloaded) return;
			if (!viewsOf(path).some((view) => view.getMode() === 'preview')) return;
			edited.set(path, editor);
			checkEdits();
		}),
	);

	// Changes from elsewhere (another device, another plugin, the Reading view menu). An open view's
	// text is newer than the saved data when typing continued after the save.
	plugin.registerEvent(
		app.metadataCache.on('changed', (file, data) => {
			const view = viewsOf(file.path)[0];
			if (!view) {
				// Not open anywhere: its sections get their class when it is next rendered.
				known.delete(file.path);
				memo.delete(file.path);
				return;
			}
			update(file.path, textDecides(file.path, view.getViewData() || data));
		}),
	);

	const checkOpenViews = () => {
		const open = new Set<MarkdownView>();
		app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (!(view instanceof MarkdownView) || !view.file) return;
			open.add(view);
			const has = decide(view.file.path);
			update(view.file.path, has);
			if (has) standIns.watch(view);
			else standIns.unwatch(view);
		});
		standIns.prune((view) => open.has(view));
	};
	plugin.registerEvent(app.workspace.on('layout-change', checkOpenViews));
	plugin.registerEvent(app.workspace.on('file-open', checkOpenViews));

	// Reading views drawn before the plugin loaded have no classes yet.
	app.workspace.onLayoutReady(() => {
		if (unloaded) return;
		app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			if (!(view instanceof MarkdownView) || !view.file) return;
			const has = decide(view.file.path);
			known.set(view.file.path, has);
			if (has) markView(view, true);
		});
	});

	plugin.register(() => {
		unloaded = true;
		checkEdits.cancel();
		edited.clear();
		standIns.destroy();
		for (const [view, timer] of pendingRerenders) view.containerEl.win.clearTimeout(timer);
		pendingRerenders.clear();
		const docs = new Set<Document>([document]);
		app.workspace.iterateAllLeaves((leaf) => {
			const view = leaf.view;
			docs.add(view.containerEl.doc);
			if (!(view instanceof MarkdownView)) return;
			for (const el of allSectionEls(view) ?? attachedSectionEls(view)) el.removeClass(WRAP_NOTE_CLASS);
		});
		// Anything else post-processed while the plugin ran (hover previews, embeds).
		for (const doc of docs) {
			for (const el of Array.from(doc.getElementsByClassName(WRAP_NOTE_CLASS))) el.removeClass(WRAP_NOTE_CLASS);
		}
		known.clear();
		memo.clear();
	});
}
