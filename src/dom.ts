// Every assumption this plugin makes about Obsidian's DOM lives in this file.
// Checked against Obsidian 1.14.4 (desktop) on 2026-10-10:
//
//   Live Preview:  div.cm-line > div.internal-embed.media-embed.image-embed[src][alt][width]
//                    > div.image-wrapper > img
//                  (inline widget inside the line, not a block widget; alt holds the text between
//                   the path and the size, e.g. "A caption|wrap-right")
//                  selected image: the embed gets .is-selected (Obsidian keeps the link's range and
//                  maps it through edits, so it stays selected when only the link text changes)
//                  native controls inside the embed: .image-resize-corner, .embed-actions > .embed-action,
//                  .edit-block-button
//                  inline image inside a sentence: the embed also has .no-hover-actions
//                  images in tables: inside .cm-table-widget (a block widget), alt keeps a trailing "\"
//                  callouts: .cm-embed-block.cm-callout (block widget with contain: paint)
//   Reading view:  p > span.internal-embed.media-embed.image-embed[src][alt][width] > img[alt][width]
//                  an image glued above text shares its <p>, followed by <br>
//                  section wrappers: .markdown-preview-sizer > div.el-p (etc.); the header (title,
//                  properties) and footer (backlinks) are sections with .mod-ui
//                  every section, attached or not: MarkdownView.previewMode.renderer.sections[].el (internal)
//                  only sections within one screen (at least 500 px) above and below the visible part are
//                  in the page; the sizer's first child, div.markdown-preview-pusher, holds the space of
//                  those above, so it always sits right before the first section in the page
//                  a table section carries inline overflow-x: auto (a formatting context of its own)
//   PDF export:    a separate window; .print > div.markdown-preview-view.markdown-rendered is passed to
//                  post-processors once, with getSectionInfo() === null (a transcluded note's
//                  .markdown-embed-content > .markdown-preview-view gets its own call); its children are
//                  one div per block (div > p, div > h2, div > ul ...), except a bare <hr>
import { EditorView } from '@codemirror/view';

export const EMBED = '.internal-embed.image-embed';
export const SELECTED_CLASS = 'is-selected';
export const NATIVE_CONTROLS = '.image-resize-corner, .embed-actions, .embed-action, .edit-block-button';
/** Content of another note shown inside this one (`![[Other note]]`). Display only. */
export const TRANSCLUSION = '.markdown-embed, .internal-embed.markdown-embed';
/** Block widgets in Live Preview whose images this plugin does not edit in v1. */
export const UNSUPPORTED_LP_CONTAINERS = '.cm-table-widget, .cm-callout, .cm-embed-block, table';

export function isElement(node: unknown): node is HTMLElement {
	return !!node && typeof node === 'object' && 'instanceOf' in node && (node as Node).instanceOf(HTMLElement);
}

/** The image embed an event happened on, if it is one this plugin may act on in Live Preview. */
export function editableEmbedFrom(target: EventTarget | null): HTMLElement | null {
	if (!isElement(target)) return null;
	const embed = target.closest<HTMLElement>(EMBED);
	if (!embed || !embed.closest('.cm-content')) return null;
	if (embed.parentElement?.closest(TRANSCLUSION)) return null;
	if (embed.closest(UNSUPPORTED_LP_CONTAINERS)) return null;
	return embed;
}

export function isNativeControl(target: EventTarget | null): boolean {
	return isElement(target) && !!target.closest(NATIVE_CONTROLS);
}

/** The CodeMirror view an element belongs to. `findFromDOM` only accepts the editor's outer element. */
export function editorViewFor(el: HTMLElement): EditorView | null {
	const editorEl = el.closest<HTMLElement>('.cm-editor');
	return editorEl ? EditorView.findFromDOM(editorEl) : null;
}

/** The image currently selected (by Obsidian) in this editor, if any. */
export function selectedEmbed(view: EditorView): HTMLElement | null {
	const el = view.contentDOM.querySelector<HTMLElement>(`${EMBED}.${SELECTED_CLASS}`);
	return el && editableEmbedFrom(el) ? el : null;
}

/** The rectangle of the note column (respects readable line length). */
export function columnRect(view: EditorView): DOMRect {
	return view.contentDOM.getBoundingClientRect();
}

/**
 * The element holding a Reading view's section elements (one div per block), the class of its header and
 * footer sections, and the class of the element before the first section in the page (see the header).
 */
export const READING_SIZER = '.markdown-preview-sizer';
export const READING_UI_SECTION = 'mod-ui';
export const READING_PUSHER = 'markdown-preview-pusher';

/** The root of a note in a PDF export: post-processed once, with no section information. */
export function isPrintRoot(el: HTMLElement): boolean {
	return el.matches('.markdown-preview-view') && !!el.closest('.print');
}

/**
 * Images that may carry layout tokens in Reading view and PDF: native embeds (matched as .internal-embed,
 * which they are from the start, before Obsidian adds .image-embed), and remote images (a bare img).
 */
export const READING_IMAGES = '.internal-embed[alt], p > img[alt]';
