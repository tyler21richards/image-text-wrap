// Which image link the toolbar, the right-click menu or a command acts on in an editor.
// Always found by document position (src/edit/locate.ts), never by filename.
import type { Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { editorLivePreviewField } from 'obsidian';
import { selectedImage } from '../dom';
import { locateAt, locateEmbed } from '../edit/locate';
import { setLayoutInView } from '../edit/write';
import type { ImageLink, Layout } from '../grammar';
import { pickLinkAtCursor } from '../ui/layout-choices';
import { keepScrollPosition, releaseScrollPosition } from './keep-scroll';

export interface LinkTarget {
	view: EditorView;
	/** The link, with document offsets. */
	link: ImageLink;
	/** The note as it was when the link was found. A write is cancelled if the note changed since. */
	doc: Text;
}

export function isLivePreview(view: EditorView): boolean {
	return view.state.field(editorLivePreviewField, false) === true;
}

/** The link behind an image in Live Preview, when this plugin may change it. */
export function targetForEmbed(view: EditorView, embed: HTMLElement): LinkTarget | null {
	if (!isLivePreview(view) || view.state.readOnly) return null;
	const located = locateEmbed(view, embed);
	if (!located || located.unsupported) return null;
	return { view, link: located.link, doc: view.state.doc };
}

/** For commands: the selected image, or else the image link on the cursor's line. */
export function targetForCommand(view: EditorView): LinkTarget | null {
	if (view.state.readOnly) return null;
	const embed = isLivePreview(view) ? selectedImage(view) : null;
	const selected = embed ? targetForEmbed(view, embed) : null;
	if (selected) return selected;
	const head = view.state.selection.main.head;
	const line = view.state.doc.lineAt(head);
	const picked = pickLinkAtCursor(line.text, head - line.from, /^\s*\|/.test(line.text));
	if (!picked) return null;
	const from = line.from + picked.from;
	const located = locateAt(view.state.doc, from);
	if (!located || located.unsupported || located.link.from !== from) return null;
	return { view, link: located.link, doc: view.state.doc };
}

/**
 * Writes the layout of the link starting at `from` as one undo step, and holds the scroll position while
 * the new layout settles. Cancels with a notice if the note is no longer `doc`.
 */
export function writeLayout(view: EditorView, from: number, layout: Layout, doc: Text): boolean {
	keepScrollPosition(view);
	const ok = setLayoutInView(view, from, layout, doc);
	if (!ok) releaseScrollPosition(view);
	return ok;
}

/** Writes the layout as one undo step, without scrolling. Cancels with a notice if the note changed. */
export function applyLayout(target: LinkTarget, layout: Layout): boolean {
	return writeLayout(target.view, target.link.from, layout, target.doc);
}
