// Keeps the editor's scroll position while a change of ours settles: a layout change from the toolbar, the
// menu or a command, and a drop.
//
// CodeMirror keeps the line at the top of the viewport still when heights change above it. It picks that
// line at scrollTop + 8 in content coordinates, which in Obsidian sits below the visible top by the height
// of the inline title. So when a picture near the top of the editor changes size (turning wrapping off
// makes its line 180px taller, measured), CodeMirror anchors on the text under it and moves scrollTop by
// that much: the picture, and the toolbar with it, jump away from the pointer (measured 2263 -> 2443).
// Undo and redo have the same problem, because view.scrollSnapshot() picks the same line.
// A drop is held by the line the image lands on instead, at the height the drop indicator showed: with
// only scrollTop kept, the text reflowing once the image has left its old place moved the new one away
// (measured 72 to 120px), and at the bottom of the note CodeMirror kept the bottom still instead (24px).
// The fix restores the position from an update listener, which runs after CodeMirror's measure loop in the
// same frame, before anything is painted. Any scrolling, key press or click by the user ends it, and so does
// anyone else moving the view (the outline, search, a link): a new selection or a request to scroll.
import type { ChangeDesc, Extension, Transaction } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { viewRestoredBy } from '../edit/write';
import { onlyImageLinksChanged } from '../ui/layout-choices';

/** Long enough for the re-drawn image to load and the heights to settle. */
const SETTLE_MS = 1000;

/**
 * What is held until `until`: a scroll position, or a line (any position in it) whose top stays `offset` px
 * below the scroll position, both in CodeMirror's document coordinates (view.lineBlockAt().top).
 */
type Pin = { until: number; top: number } | { until: number; pos: number; offset: number };

const pins = new WeakMap<EditorView, Pin>();

/** Call just before writing: the scroll position is held for a moment while the layout settles. */
export function keepScrollPosition(view: EditorView): void {
	pins.set(view, { top: view.scrollDOM.scrollTop, until: Date.now() + SETTLE_MS });
}

/**
 * Call just after writing: the line at `pos` is held with its top `offset` px below the scroll position
 * (view.lineBlockAt(pos).top - scrollTop) while the layout settles. Later edits move it with its text.
 */
export function keepLineAt(view: EditorView, pos: number, offset: number): void {
	pins.set(view, { pos, offset, until: Date.now() + SETTLE_MS });
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
	const top = 'pos' in pin ? view.lineBlockAt(pin.pos).top - pin.offset : pin.top;
	if (Math.abs(view.scrollDOM.scrollTop - top) >= 1) view.scrollDOM.scrollTop = top;
}

function mapPin(view: EditorView, changes: ChangeDesc): void {
	const pin = pins.get(view);
	if (pin && 'pos' in pin) pin.pos = changes.mapPos(pin.pos, 1);
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

/**
 * CodeMirror does not export the type of EditorView.scrollIntoView's effect (nor the class of its value),
 * so the class is taken from an effect made here: only that effect carries one.
 */
const ScrollTarget = (EditorView.scrollIntoView(0).value as object).constructor;

/**
 * Whether a transaction moves the view somewhere else: it changes the selection or asks to scroll. That is
 * how Obsidian's outline, search, links and commands navigate. Our own writes do neither. (Obsidian also
 * sends the selection unchanged when the editor gets focus; that is not navigation.)
 */
function navigates(tr: Transaction): boolean {
	if (tr.scrollIntoView || tr.effects.some((e) => e.value instanceof ScrollTarget)) return true;
	return tr.selection !== undefined && !tr.selection.eq(tr.startState.selection.map(tr.changes));
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
		const { view } = update;
		for (const tr of update.transactions) {
			const restored = viewRestoredBy(tr);
			const line = restored ? null : layoutUndoLine(tr);
			// Undo and redo of a move go back to the view from before it (write.ts).
			if (restored) keepLineAt(view, restored.pos, restored.offset);
			// Undo and redo of a layout change are held like the change itself.
			else if (line !== null && onScreen(view, line)) keepScrollPosition(view);
			else if (navigates(tr)) releaseScrollPosition(view);
			else if (tr.docChanged) mapPin(view, tr.changes);
		}
		restore(view);
	});
}
