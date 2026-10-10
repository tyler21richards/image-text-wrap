// The same layout choices in Obsidian's right-click image menu (brief 4.1, extras).
//
// Obsidian's menu for an image fires workspace "file-menu" with source "link-context-menu", but it does
// not say which embed was clicked. So the element under each right-click is noted on its way down
// (capture phase, in every window) and mapped to its link by position. The approach is adapted from
// Adjustable Media (src/view/imageMenu.ts, src/view/windows.ts), MIT, (c) 2026 Yi-luo-hua.
//
// Reading view: each rendered section is remembered with its post-processor context, so a clicked image
// maps to its line through getSectionInfo() and its order in the section; the write goes through
// vault.process, never the hidden editor. Obsidian 1.14.4 opens its lightbox on a right-click in Reading
// view and fires no file-menu there, so this path only runs where Obsidian does show that menu.
// Remote and data-URI images get no entries: Obsidian's menu for them fires no file-menu event.
import { Text } from '@codemirror/state';
import { type App, type MarkdownPostProcessorContext, type Menu, type TFile } from 'obsidian';
import { drawnImages, drawnTarget, editableImageFrom, editorViewFor, isElement, readingImageFrom } from './dom';
import { locateAt } from './edit/locate';
import { setLayoutInFile } from './edit/write';
import { GAPS, type Gap, type Layout } from './grammar';
import { registerIcons } from './icons';
import { applyLayout, targetForEmbed } from './live-preview/toolbar-target';
import type ImageTextWrapPlugin from './main';
import { GAP_LABELS } from './settings';
import { SPACING_LABEL, WRAP_CHOICES, layoutAfterWrapClick, layoutForGap } from './ui/layout-choices';
import { lineOffset, linkForDrawnImage, sectionImageLinks } from './ui/section-images';

// Sections of our own, so the choices form their own groups. Obsidian sorts sections it does not know
// just above "Delete image" (measured on 1.14.4). Its "image" section would put them between "Copy image"
// and "Swap file...", because Obsidian adds its other image items only after file-menu has run.
const LAYOUT_SECTION = 'image-text-wrap';
const SPACING_SECTION = 'image-text-wrap-spacing';
/** A file-menu this long after the right-click belongs to some other gesture. */
const CLICK_TTL_MS = 1000;

interface MenuSubject {
	layout: Layout;
	apply(layout: Layout): void;
}

/** Runs `watch` for the main window's document and for every pop-out window's, now and later. */
function onEveryDocument(plugin: ImageTextWrapPlugin, watch: (doc: Document) => void): void {
	const seen = new WeakSet<Document>();
	const add = (doc: Document) => {
		if (seen.has(doc)) return;
		seen.add(doc);
		watch(doc);
	};
	add(document);
	plugin.registerEvent(plugin.app.workspace.on('window-open', (win) => add(win.doc)));
	plugin.app.workspace.onLayoutReady(() => {
		plugin.app.workspace.iterateAllLeaves((leaf) => add(leaf.view.containerEl.doc));
	});
}

function livePreviewSubject(target: HTMLElement): MenuSubject | null {
	const embed = editableImageFrom(target);
	const view = embed ? editorViewFor(embed) : null;
	const link = view && embed ? targetForEmbed(view, embed) : null;
	if (!link) return null;
	// The note as it is now: if it changes before an item is clicked, the write is cancelled with a notice.
	return {
		layout: link.link.layout,
		apply: (layout) => {
			applyLayout(link, layout);
			// A right-click leaves focus on the image element, where Cmd+Z would not reach the editor.
			if (!link.view.hasFocus) link.view.focus();
		},
	};
}

function readingSubject(
	app: App,
	target: HTMLElement,
	sections: WeakMap<HTMLElement, MarkdownPostProcessorContext>,
): MenuSubject | null {
	const image = readingImageFrom(target);
	if (!image) return null;
	let section = image.parentElement;
	let ctx: MarkdownPostProcessorContext | undefined;
	while (section && !(ctx = sections.get(section))) section = section.parentElement;
	if (!section || !ctx) return null;
	const info = ctx.getSectionInfo(section);
	const file: TFile | null = app.vault.getFileByPath(ctx.sourcePath);
	if (!info || !file) return null;

	const drawn = drawnImages(section);
	const lines = info.text.split('\n');
	const found = linkForDrawnImage(sectionImageLinks(lines, info.lineStart, info.lineEnd), drawn.length, drawn.indexOf(image));
	if (!found) return null;
	const offset = lineOffset(lines, found.line) + found.link.from;
	// Checks the link's target against the drawn image and that the line is plain body text.
	const located = locateAt(Text.of(lines), offset, drawnTarget(image));
	if (!located || located.unsupported || located.link.from !== offset) return null;
	const raw = info.text.slice(located.link.from, located.link.to);
	return {
		layout: located.link.layout,
		apply: (layout) => void setLayoutInFile(app, file, offset, raw, layout),
	};
}

function addLayoutItems(menu: Menu, subject: MenuSubject, defaultGap: Gap): void {
	const { layout } = subject;
	for (const choice of WRAP_CHOICES) {
		menu.addItem((item) =>
			item
				.setTitle(choice.label)
				.setIcon(choice.icon)
				.setChecked(layout.wrap === choice.wrap)
				.setSection(LAYOUT_SECTION)
				.onClick(() => {
					const next = layoutAfterWrapClick(layout, choice.wrap, defaultGap);
					if (next.wrap !== layout.wrap || next.gap !== layout.gap) subject.apply(next);
				}),
		);
	}
	// Spacing only means something while text wraps around the picture.
	if (layout.wrap === 'none') return;
	for (const gap of GAPS) {
		menu.addItem((item) =>
			item
				.setTitle(`${SPACING_LABEL}: ${GAP_LABELS[gap]}`)
				.setChecked(layout.gap === gap)
				.setSection(SPACING_SECTION)
				.onClick(() => {
					const next = layoutForGap(layout, gap);
					if (next) subject.apply(next);
				}),
		);
	}
}

export function registerImageMenu(plugin: ImageTextWrapPlugin): void {
	registerIcons(plugin);
	let clicked: { target: HTMLElement; at: number } | null = null;
	onEveryDocument(plugin, (doc) =>
		plugin.registerDomEvent(
			doc,
			'contextmenu',
			(e) => {
				clicked = isElement(e.target) ? { target: e.target, at: Date.now() } : null;
			},
			{ capture: true },
		),
	);

	const sections = new WeakMap<HTMLElement, MarkdownPostProcessorContext>();
	plugin.registerMarkdownPostProcessor((el, ctx) => {
		sections.set(el, ctx);
	});

	plugin.registerEvent(
		plugin.app.workspace.on('file-menu', (menu, _file, source) => {
			const click = clicked;
			if (source !== 'link-context-menu' || !click || Date.now() - click.at > CLICK_TTL_MS) return;
			clicked = null;
			const subject = livePreviewSubject(click.target) ?? readingSubject(plugin.app, click.target, sections);
			if (subject) addLayoutItems(menu, subject, plugin.settings.defaultGap);
		}),
	);
}
