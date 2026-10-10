// Keeps the editor's scroll position while a layout change from the toolbar, menu or a command settles.
//
// CodeMirror keeps the line at the top of the viewport still when heights change above it. It picks that
// line at scrollTop + 8 in content coordinates, which in Obsidian sits below the visible top by the height
// of the inline title. So when a picture near the top of the editor changes size (turning wrapping off
// makes its line 180px taller, measured), CodeMirror anchors on the text under it and moves scrollTop by
// that much: the picture, and the toolbar with it, jump away from the pointer (measured 2263 -> 2443).
// Undo and redo have the same problem, because view.scrollSnapshot() picks the same line.
// The fix restores scrollTop from an update listener, which runs after CodeMirror's measure loop in the
// same frame, before anything is painted. Any scrolling, key press or click by the user ends it.
import type { Extension, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { onlyImageLinksChanged } from '../ui/layout-choices';

/** Long enough for the re-drawn image to load and the heights to settle. */
const SETTLE_MS = 1000;

const pins = new WeakMap<EditorView, { top: number; until: number }>();

/** Call just before writing: the scroll position is held for a moment while the layout settles. */
export function keepScrollPosition(view: EditorView): void {
	pins.set(view, { top: view.scrollDOM.scrollTop, until: Date.now() + SETTLE_MS });
}

/** The user moved on: let the editor scroll freely again. */
export function releaseScrollPosition(view: EditorView): void {
	pins.delete(view);
}

function restore(view: EditorView): void {
	const pin = pins.get(view);
	if (!pin) return;
	if (Date.now() > pin.until) {
		pins.delete(view);
		return;
	}
	if (Math.abs(view.scrollDOM.scrollTop - pin.top) >= 1) view.scrollDOM.scrollTop = pin.top;
}

/**
 * The document position of the one line an undo or redo changed, when all it did was rewrite image links
 * there (a layout change), or null.
 */
function layoutUndoLine(tr: Transaction): number | null {
	if (!tr.docChanged || !(tr.isUserEvent('undo') || tr.isUserEvent('redo'))) return null;
	let line: number | null = null;
	let single = true;
	tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
		const a = tr.startState.doc.lineAt(fromA);
		const b = tr.state.doc.lineAt(fromB);
		if (a.number !== tr.startState.doc.lineAt(toA).number || b.number !== tr.state.doc.lineAt(toB).number) single = false;
		if (line !== null && line !== b.from) single = false;
		line = b.from;
	});
	if (!single || line === null) return null;
	const after = tr.state.doc.lineAt(line);
	const before = tr.startState.doc.line(after.number);
	return onlyImageLinksChanged(before.text, after.text) ? line : null;
}

/** True when the line at `pos` is on screen, so holding the scroll position hides nothing. */
function onScreen(view: EditorView, pos: number): boolean {
	const block = view.lineBlockAt(pos);
	const scroller = view.scrollDOM.getBoundingClientRect();
	const top = view.documentTop + block.top;
	return top < scroller.bottom && top + block.height > scroller.top;
}

export function keepScrollExtension(): Extension {
	return EditorView.updateListener.of((update) => {
		restore(update.view);
		for (const tr of update.transactions) {
			const line = layoutUndoLine(tr);
			if (line !== null && onScreen(update.view, line)) keepScrollPosition(update.view);
		}
	});
}
