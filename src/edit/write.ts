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
	EditorState,
	StateEffect,
	type ChangeSpec,
	type Extension,
	type Text,
	type Transaction,
} from '@codemirror/state';
import { EditorView, ViewPlugin } from '@codemirror/view';
import { Notice, type App, type TFile } from 'obsidian';
import { parseImageLinkAt, relayout, type Layout } from '../grammar';
import { locateAt } from './locate';

/** Marks our transactions, and the undo/redo transactions that reverse them. */
const ownGesture = StateEffect.define<null>();

export const USER_EVENT = {
	layout: 'input.image-text-wrap',
	move: 'move.image-text-wrap',
} as const;

export const CHANGED_ELSEWHERE = 'The note changed while you were working on the image. Nothing was changed. Please try again.';

/** Writes changes as one undo step that never merges with typing, and does not scroll. */
export function dispatchOwn(view: EditorView, changes: ChangeSpec, userEvent: string): void {
	view.dispatch({
		changes,
		userEvent,
		annotations: isolateHistory.of('full'),
		effects: ownGesture.of(null),
		scrollIntoView: false,
	});
}

function isOwnHistory(tr: Transaction): boolean {
	return (tr.isUserEvent('undo') || tr.isUserEvent('redo')) && tr.effects.some((e) => e.is(ownGesture));
}

/**
 * Undo and redo normally scroll to the restored cursor. For our own gestures, keep the viewport where
 * it is instead. A scroll handler would be too late: CodeMirror has already moved its viewport by then.
 */
export function historyScrollFix(): Extension {
	const views = new WeakMap<EditorState, EditorView>();
	return [
		invertedEffects.of((tr) => (tr.effects.some((e) => e.is(ownGesture)) ? [ownGesture.of(null)] : [])),
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
			return { effects: view.scrollSnapshot().map(tr.changes) };
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
