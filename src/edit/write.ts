// The only code that writes notes.
//
// Live Preview writes go through CodeMirror's own dispatch: one transaction, its own undo step,
// and no scrolling. (Obsidian's Editor.transaction() scrolls to the cursor, measured 3671px -> 87px.)
// Reading view never writes to its hidden editor (changes there are lost); it uses vault.process.
//
// The undo/redo scroll fix is adapted from Adjustable Media (src/view/layoutHistory.ts,
// src/layout/editorTransaction.ts), MIT, (c) 2026 Yi-luo-hua.
import { invertedEffects, isolateHistory } from '@codemirror/commands';
import {
	EditorSelection,
	EditorState,
	StateEffect,
	type ChangeDesc,
	type ChangeSpec,
	type Extension,
	type SelectionRange,
	type StateEffectType,
	type Text,
	type Transaction,
} from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { Notice, type App, type TFile } from 'obsidian';
import { parseImageLinkAt, relayout, type Layout } from '../grammar';
import { locateAt } from './locate';

/** Marks our transactions, and the undo/redo transactions that reverse them. */
const ownGesture = StateEffect.define<null>();

/** A view: the line at `pos` with its top `offset` px below the scroll position (lineBlockAt().top - scrollTop). */
export interface ViewMark {
	pos: number;
	offset: number;
}

const mapMark = (mark: ViewMark, changes: ChangeDesc): ViewMark => ({ pos: changes.mapPos(mark.pos, 1), offset: mark.offset });
/** On a move, and on its undo and redo: the view just before it, in the note as it was then (never mapped). */
const viewBefore = StateEffect.define<ViewMark>();
/** On the undo or redo of a move: the view to go back to, in the note as it is after it. */
const viewToRestore = StateEffect.define<ViewMark>({ map: mapMark });
/** On every undo and redo of our steps: the view it keeps, in the note as it is after it (keep-scroll.ts holds it). */
const viewKept = StateEffect.define<ViewMark>({ map: mapMark });

export const USER_EVENT = {
	layout: 'input.image-text-wrap',
	move: 'move.image-text-wrap',
} as const;

export const CHANGED_ELSEWHERE = 'The note changed while you were working on the image. Nothing was changed. Please try again.';

/** The view as it is now, told by the first line at the top of the editor. */
export function markView(view: EditorView): ViewMark {
	const block = view.lineBlockAtHeight(Math.max(0, view.scrollDOM.getBoundingClientRect().top - view.documentTop));
	return { pos: block.from, offset: block.top - view.scrollDOM.scrollTop };
}

/**
 * Writes changes as one undo step that never merges with typing, and does not scroll. With `undoView`,
 * undoing the step brings the view back to how it is now (or to the view given, taken earlier from markView
 * on the same note), and redoing it to how it was before the undo.
 */
export function dispatchOwn(
	view: EditorView,
	changes: ChangeSpec,
	userEvent: string,
	{ undoView = false }: { undoView?: boolean | ViewMark } = {},
): void {
	const effects: StateEffect<unknown>[] = [ownGesture.of(null)];
	if (undoView) effects.push(viewBefore.of(undoView === true ? markView(view) : undoView));
	view.dispatch({
		changes,
		userEvent,
		annotations: isolateHistory.of('full'),
		effects,
		scrollIntoView: false,
	});
}

function isOwnHistory(tr: Transaction): boolean {
	return (tr.isUserEvent('undo') || tr.isUserEvent('redo')) && tr.effects.some((e) => e.is(ownGesture));
}

/** The view an undo or redo of one of our steps written with `undoView` goes back to, or null. */
function viewRestoredBy(tr: Transaction): ViewMark | null {
	for (const e of tr.effects) if (e.is(viewToRestore)) return e.value;
	return null;
}

/** The view an undo or redo of one of our steps keeps (historyScrollFix), or null for any other transaction. */
export function viewKeptBy(tr: Transaction): ViewMark | null {
	for (const e of tr.effects) if (e.is(viewKept)) return e.value;
	return null;
}

type ScrollTarget = ReturnType<EditorView['scrollSnapshot']>['value'];
type ScrollTargetClass = new (
	range: SelectionRange,
	y: 'start',
	x: 'start',
	yMargin: number,
	xMargin: number,
	isSnapshot: boolean,
) => ScrollTarget;

/**
 * A scroll snapshot like EditorView.scrollSnapshot(), but of `mark` rather than of the line CodeMirror picks
 * (the one at scrollTop + 8): applied, it puts the line at `mark.pos` `mark.offset` px below the scroll
 * position (a snapshot holds a position in its line, and that line's top minus scrollTop). Null when this
 * CodeMirror makes its snapshots some other way.
 */
function snapshotOf(view: EditorView, mark: ViewMark): StateEffect<ScrollTarget> | null {
	const own = view.scrollSnapshot();
	// CodeMirror exports neither the class of the value nor the type of the effect: both come from its own.
	const Target = own.value.constructor as ScrollTargetClass;
	const type = (own as unknown as { type?: StateEffectType<ScrollTarget> }).type;
	const target = new Target(EditorSelection.cursor(mark.pos), 'start', 'start', mark.offset, own.value.xMargin, true);
	if (!type || target.isSnapshot !== true || target.range.head !== mark.pos || target.yMargin !== mark.offset) return null;
	return type.of(target);
}

/**
 * Undo and redo normally scroll to the restored cursor. For our own gestures, keep the viewport where
 * it is instead. A scroll handler would be too late: CodeMirror has already moved its viewport by then.
 *
 * Each undo and redo of ours carries the view it keeps (viewKeptBy, held by keep-scroll.ts while the layout
 * settles), and a scroll snapshot of that same view in place of the scroll to the cursor. A move's goes back
 * to the view from before it; any other keeps the line at the top of the editor. CodeMirror's own snapshot
 * holds the line at scrollTop + 8 instead, which in Obsidian sits below the inline title: the text under a
 * picture near the top, or the moved image's own line, which the undo takes out. The stand-ins send a
 * scroll request again once heights change (stand-ins.ts), so that snapshot was applied a second time, after
 * the picture had changed size, and the view jumped by as much (measured: 24 to 900px).
 */
export function historyScrollFix(): Extension {
	const views = new WeakMap<EditorState, EditorView>();
	return [
		invertedEffects.of((tr) => {
			if (!tr.effects.some((e) => e.is(ownGesture))) return [];
			const out: StateEffect<unknown>[] = [ownGesture.of(null)];
			// Positions in the note before `tr`, which is the note its reversal leaves.
			for (const e of tr.effects) if (e.is(viewBefore)) out.push(viewToRestore.of(e.value));
			return out;
		}),
		ViewPlugin.define((view) => {
			views.set(view.state, view);
			return {
				update: () => {
					views.set(view.state, view);
				},
			};
		}),
		EditorState.transactionExtender.of((tr) => {
			const view = views.get(tr.startState);
			if (!isOwnHistory(tr) || !view || typeof view.scrollSnapshot !== 'function') return null;
			const restored = viewRestoredBy(tr);
			const kept = restored ?? mapMark(markView(view), tr.changes);
			const effects: StateEffect<unknown>[] = [viewKept.of(kept)];
			const snapshot = snapshotOf(view, kept) ?? view.scrollSnapshot().map(tr.changes);
			if (snapshot) effects.push(snapshot);
			// For the step that reverses this one (redo after undo, undo after redo).
			if (restored) effects.push(viewBefore.of(markView(view)));
			return { effects };
		}),
	];
}

/**
 * Sets the layout of the image link that starts at `from` in a Live Preview editor.
 * `expectDoc` is the document the caller looked at; if the note changed since, nothing is written.
 */
export function setLayoutInView(view: EditorView, from: number, layout: Layout, expectDoc?: Text): boolean {
	if (view.state.readOnly) return false;
	if (expectDoc && view.state.doc !== expectDoc) {
		new Notice(CHANGED_ELSEWHERE);
		return false;
	}
	const located = locateAt(view.state.doc, from);
	if (!located || located.link.from !== from) {
		new Notice(CHANGED_ELSEWHERE);
		return false;
	}
	const text = view.state.sliceDoc(located.line.from, located.line.to);
	const rel = { ...located.link, from: located.link.from - located.line.from, to: located.link.to - located.line.from };
	const insert = relayout(text, rel, layout);
	if (insert === text.slice(rel.from, rel.to)) return true;
	dispatchOwn(view, { from: located.link.from, to: located.link.to, insert }, USER_EVENT.layout);
	return true;
}

/**
 * Sets the layout of the image link at a known offset in a file, for Reading view.
 * `expectRaw` is the link text seen when the menu opened; if it is not there any more, nothing is written.
 */
export async function setLayoutInFile(
	app: App,
	file: TFile,
	offset: number,
	expectRaw: string,
	layout: Layout,
): Promise<boolean> {
	let ok = false;
	await app.vault.process(file, (data) => {
		if (data.slice(offset, offset + expectRaw.length) !== expectRaw) return data;
		const lineStart = data.lastIndexOf('\n', offset - 1) + 1;
		const lineEnd = data.indexOf('\n', offset);
		const line = data.slice(lineStart, lineEnd === -1 ? data.length : lineEnd);
		const link = parseImageLinkAt(line, offset - lineStart, /^\s*\|/.test(line));
		if (!link) return data;
		ok = true;
		return data.slice(0, offset) + relayout(line, link, layout) + data.slice(offset + expectRaw.length);
	});
	if (!ok) new Notice(CHANGED_ELSEWHERE);
	return ok;
}
