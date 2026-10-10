// Classes on editor lines that hold a wrapped image, and on the editor when the note has any wrap.
// Rendering itself stays in styles.css; these classes only scope it.
import { StateField, type Range, type Text, type Transaction } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import { findImageLinks, ANY_LAYOUT_TOKEN, DEFAULT_GAP, type Layout } from '../grammar';
import { isPlainLine, opensOrCloses, scanLines, type LineInfo } from '../markdown/lines';

export const EDITOR_CLASS = 'itw-has-wrap';
export const LINE_CLASS = 'itw-image-line';

/** The layout of a line that holds exactly one wrapped image link and nothing else, or null. */
export function soleImageLayout(lineText: string): Layout | null {
	if (!lineText.trimStart().startsWith('!')) return null;
	const links = findImageLinks(lineText);
	if (links.length !== 1) return null;
	const link = links[0]!;
	if (lineText.slice(0, link.from).trim() || lineText.slice(link.to).trim()) return null;
	return link.layout.wrap === 'none' ? null : link.layout;
}

/**
 * True when a sole image line gets the line class: only in body text paragraphs, the rule the stand-ins
 * use too. In code, math, comments and frontmatter the link is text, and in lists, quotes, tables,
 * headings and indented lines the picture stays in line, so the line keeps its height.
 */
function takesLineClass(info: LineInfo | undefined): boolean {
	return info?.context === 'text' && info.kind === 'paragraph';
}

export function docHasWrap(doc: Text): boolean {
	for (const iter = doc.iter(); !iter.next().done; ) {
		if (!iter.lineBreak && ANY_LAYOUT_TOKEN.test(iter.value)) return true;
	}
	return false;
}

const lineDecos = new Map<string, Decoration>();
function lineDeco(layout: Layout): Decoration {
	const key = `${layout.wrap}:${layout.gap}`;
	let deco = lineDecos.get(key);
	if (!deco) {
		const gap = layout.gap === DEFAULT_GAP ? '' : ` itw-gap-${layout.gap}`;
		deco = Decoration.line({ class: `${LINE_CLASS} ${LINE_CLASS}-${layout.wrap}${gap}` });
		lineDecos.set(key, deco);
	}
	return deco;
}

/** scanLines over the whole note, run at most once and only when a line needs it. */
function lazyScan(doc: Text): () => readonly LineInfo[] {
	let infos: LineInfo[] | null = null;
	return () => {
		if (!infos) {
			const lines: string[] = [];
			for (const iter = doc.iterLines(); !iter.next().done; ) lines.push(iter.value);
			infos = scanLines(lines);
		}
		return infos;
	};
}

/** Line decorations for the lines `from` to `to` (1-based, inclusive). */
function lineDecorations(doc: Text, from: number, to: number, scan: () => readonly LineInfo[]): Range<Decoration>[] {
	const out: Range<Decoration>[] = [];
	for (let n = from; n <= to; n++) {
		const line = doc.line(n);
		if (line.length === 0 || !line.text.includes('![')) continue;
		const layout = soleImageLayout(line.text);
		if (layout && takesLineClass(scan()[n - 1])) out.push(lineDeco(layout).range(line.from));
	}
	return out;
}

function buildLineDecorations(doc: Text): DecorationSet {
	return Decoration.set(lineDecorations(doc, 1, doc.lines, lazyScan(doc)));
}

interface LineState {
	hasWrap: boolean;
	decorations: DecorationSet;
}

const NO_WRAP: LineState = { hasWrap: false, decorations: Decoration.none };

/** The lines one change touched: `a*` in the old document, `b*` in the new one (1-based, inclusive). */
interface LineEdit {
	aFrom: number;
	aTo: number;
	bFrom: number;
	bTo: number;
}

function lineEdits(tr: Transaction): LineEdit[] {
	const a = tr.startState.doc;
	const b = tr.state.doc;
	const out: LineEdit[] = [];
	tr.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
		out.push({ aFrom: a.lineAt(fromA).number, aTo: a.lineAt(toA).number, bFrom: b.lineAt(fromB).number, bTo: b.lineAt(toB).number });
	});
	return out;
}

function someLine(doc: Text, from: number, to: number, test: (text: string) => boolean): boolean {
	for (let n = from; n <= to; n++) if (test(doc.line(n).text)) return true;
	return false;
}

const hasToken = (text: string) => ANY_LAYOUT_TOKEN.test(text);
const notPlain = (text: string) => !isPlainLine(text);

/** The first blank line after line `n`, or the last line: scanLines reads every line after it as before. */
function nextBlankLine(doc: Text, n: number): number {
	for (let k = n + 1; k <= doc.lines; k++) if (doc.line(k).text.trim() === '') return k;
	return doc.lines;
}

/**
 * The decorations after a change. They are rebuilt for the whole note only when the change can open or
 * close code, math, a comment or frontmatter; otherwise only the lines whose reading can have changed
 * are redone, and the note is scanned only when one of those lines holds a wrapped image.
 */
function updateDecorations(value: LineState, tr: Transaction, edits: readonly LineEdit[]): DecorationSet {
	const a = tr.startState.doc;
	const b = tr.state.doc;
	const frontmatter = a.line(1).text.trimEnd() === '---' || b.line(1).text.trimEnd() === '---';
	const farReaching = (text: string) => opensOrCloses(text, frontmatter);
	if (edits.some((e) => someLine(a, e.aFrom, e.aTo, farReaching) || someLine(b, e.bFrom, e.bTo, farReaching))) {
		return buildLineDecorations(b);
	}
	let decorations = value.decorations.map(tr.changes);
	const scan = lazyScan(b);
	for (const e of edits) {
		// An edit between plain lines changes how only its own lines are read. Any other edit can also
		// change the line before it (which a table delimiter row turns into a table header) and the lines
		// after it up to the next blank line (rows of a table, or what follows a setext underline).
		const local = !someLine(a, e.aFrom, e.aTo, notPlain) && !someLine(b, e.bFrom, e.bTo, notPlain);
		const first = local ? e.bFrom : Math.max(1, e.bFrom - 1);
		const last = local ? e.bTo : nextBlankLine(b, e.bTo);
		const from = b.line(first).from;
		const to = b.line(last).to;
		const add = lineDecorations(b, first, last, scan);
		let had = false;
		decorations.between(from, to, () => {
			had = true;
			return false;
		});
		if (!had && add.length === 0) continue;
		decorations = decorations.update({ filterFrom: from, filterTo: to, filter: () => false, add });
	}
	return decorations;
}

/**
 * Kept as a state field over the whole note (not just the viewport) so line heights are the same
 * whether or not a line is on screen, which keeps CodeMirror's height map honest. Updated
 * incrementally: typing re-reads only the lines it touched, not the whole note.
 */
export const lineClassField = StateField.define<LineState>({
	create(state) {
		const hasWrap = docHasWrap(state.doc);
		return hasWrap ? { hasWrap, decorations: buildLineDecorations(state.doc) } : NO_WRAP;
	},
	update(value, tr) {
		if (!tr.docChanged) return value;
		const edits = lineEdits(tr);
		const a = tr.startState.doc;
		const b = tr.state.doc;
		const added = edits.some((e) => someLine(b, e.bFrom, e.bTo, hasToken));
		if (!value.hasWrap && !added) return value;
		// A token can only disappear from the lines the change touched.
		const removed = value.hasWrap && edits.some((e) => someLine(a, e.aFrom, e.aTo, hasToken));
		const hasWrap = added || (value.hasWrap && (!removed || docHasWrap(b)));
		if (!hasWrap) return NO_WRAP;
		if (!value.hasWrap) return { hasWrap, decorations: buildLineDecorations(b) };
		return { hasWrap, decorations: updateDecorations(value, tr, edits) };
	},
	provide: (field) => [
		EditorView.decorations.from(field, (v) => v.decorations),
		EditorView.editorAttributes.of((view) =>
			view.state.field(field, false)?.hasWrap ? { class: EDITOR_CLASS } : null,
		),
	],
});
