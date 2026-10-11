// Classes on editor lines that hold a wrapped image, and on the editor when the note has any wrap.
// Rendering itself stays in styles.css; these classes only scope it.
import { StateField, type Range, type Text, type Transaction } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import { findImageLinks, isExternalTarget, ANY_LAYOUT_TOKEN, DEFAULT_GAP, type Layout } from '../grammar';
import { isPlainLine, lastLineAffected, opensOrCloses, scanLines, type LineInfo } from '../markdown/lines';

export const EDITOR_CLASS = 'itw-has-wrap';
export const LINE_CLASS = 'itw-image-line';
/** A line of wrapped images only, more than one: it takes no height, like a line with one. */
export const MULTI_CLASS = `${LINE_CLASS}-multi`;
/** Around a remote or data-URI image wrapped where no line class covers it (its alt is on the inner img). */
export const INLINE_CLASS = 'itw-inline';
/** On a line of a list item, quote or footnote that holds a wrapped image: the picture stays in line. */
export const KEEP_IN_LINE_CLASS = 'itw-keep-in-line';

/**
 * True when a line's wrapped images float: only in body text paragraphs, the rule the stand-ins use
 * too. In code, math, comments and frontmatter the link is text, and in lists, quotes, footnotes,
 * tables, headings and indented lines the picture stays in line, so the line keeps its height.
 */
function takesLineClass(info: LineInfo | undefined): boolean {
	return info?.context === 'text' && info.kind === 'paragraph';
}

/** True on a line whose wrapped images styles.css keeps in line (Obsidian marks some of these lines, not all). */
function keepsInLine(info: LineInfo | undefined): boolean {
	return info?.context === 'text' && (info.kind === 'list' || info.kind === 'quote' || info.kind === 'footnote');
}

const gapClass = (layout: Layout) => (layout.gap === DEFAULT_GAP ? '' : ` itw-gap-${layout.gap}`);

/** Classes for one editor line and for parts of it (offsets within the line). */
export interface LineClasses {
	line: string | null;
	/** An image line that starts with spaces, which must not get Obsidian's hanging indent. */
	noIndent?: boolean;
	marks: { from: number; to: number; class: string }[];
}

/**
 * The classes a line gets, from its text and how the note's scan reads it:
 * - a line of one wrapped image, or of several images all wrapped left or right, takes no height;
 * - a remote or data-URI image wrapped anywhere else in body text gets a class around it, which floats
 *   it as Reading view does (styles.css cannot see its layout otherwise);
 * - in a list item, quote or footnote the line is marked to keep its pictures in line.
 */
export function lineClassesFor(text: string, info: LineInfo | undefined): LineClasses | null {
	if (!text.includes('![')) return null;
	const links = findImageLinks(text);
	if (!links.some((link) => link.layout.wrap !== 'none')) return null;
	if (keepsInLine(info)) return { line: KEEP_IN_LINE_CLASS, marks: [] };
	if (!takesLineClass(info)) return null;
	// Nothing but image links and spaces on the line.
	const imagesOnly =
		!text.slice(links[links.length - 1]!.to).trim() &&
		links.every((link, i) => !text.slice(i === 0 ? 0 : links[i - 1]!.to, link.from).trim());
	const noIndent = /^[ \t]/.test(text);
	if (imagesOnly && links.length === 1) {
		const layout = links[0]!.layout;
		return { line: `${LINE_CLASS} ${LINE_CLASS}-${layout.wrap}${gapClass(layout)}`, noIndent, marks: [] };
	}
	const multi = imagesOnly && links.every((link) => link.layout.wrap === 'left' || link.layout.wrap === 'right');
	const marks = links
		.filter((link) => link.layout.wrap !== 'none' && isExternalTarget(link.target))
		.map((link) => ({ from: link.from, to: link.to, class: `${INLINE_CLASS}-${link.layout.wrap}${gapClass(link.layout)}` }));
	return { line: multi ? `${LINE_CLASS} ${MULTI_CLASS}` : null, noIndent: multi && noIndent, marks };
}

export function docHasWrap(doc: Text): boolean {
	for (const iter = doc.iter(); !iter.next().done; ) {
		if (!iter.lineBreak && ANY_LAYOUT_TOKEN.test(iter.value)) return true;
	}
	return false;
}

/**
 * Obsidian gives a line that starts with spaces a hanging indent, as an inline style. On an image line it
 * measures none (styles.css), but until it measures, and when it remembers another line's indent for
 * this line number, it uses a guess. Written after Obsidian's in the line's style, this one wins.
 */
const NO_INDENT = { style: 'text-indent: 0; padding-inline-start: 0' };

const lineDecos = new Map<string, Decoration>();
function lineDeco(cls: string, noIndent = false): Decoration {
	const key = `${cls}${noIndent ? ' (no indent)' : ''}`;
	let deco = lineDecos.get(key);
	if (!deco) {
		deco = Decoration.line(noIndent ? { class: cls, attributes: NO_INDENT } : { class: cls });
		lineDecos.set(key, deco);
	}
	return deco;
}

const markDecos = new Map<string, Decoration>();
function markDeco(cls: string): Decoration {
	let deco = markDecos.get(cls);
	if (!deco) {
		// Inclusive, so the mark also wraps Obsidian's image widget, which replaces the whole link.
		deco = Decoration.mark({ class: cls, inclusive: true });
		markDecos.set(cls, deco);
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

/** Decorations for the lines `from` to `to` (1-based, inclusive), sorted. */
function lineDecorations(doc: Text, from: number, to: number, scan: () => readonly LineInfo[]): Range<Decoration>[] {
	const out: Range<Decoration>[] = [];
	for (let n = from; n <= to; n++) {
		const line = doc.line(n);
		if (line.length === 0 || !line.text.includes('![') || !ANY_LAYOUT_TOKEN.test(line.text)) continue;
		const classes = lineClassesFor(line.text, scan()[n - 1]);
		if (!classes) continue;
		if (classes.line) out.push(lineDeco(classes.line, classes.noIndent).range(line.from));
		for (const mark of classes.marks) out.push(markDeco(mark.class).range(line.from + mark.from, line.from + mark.to));
	}
	return out;
}

function buildLineDecorations(doc: Text): DecorationSet {
	return Decoration.set(lineDecorations(doc, 1, doc.lines, lazyScan(doc)), true);
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
		// change the line before it and some lines after it (lastLineAffected).
		const local = !someLine(a, e.aFrom, e.aTo, notPlain) && !someLine(b, e.bFrom, e.bTo, notPlain);
		const first = local ? e.bFrom : Math.max(1, e.bFrom - 1);
		const last = local ? e.bTo : lastLineAffected(e.bTo, b.lines, (k) => b.line(k).text);
		const from = b.line(first).from;
		const to = b.line(last).to;
		const add = lineDecorations(b, first, last, scan);
		let had = false;
		decorations.between(from, to, () => {
			had = true;
			return false;
		});
		if (!had && add.length === 0) continue;
		decorations = decorations.update({ filterFrom: from, filterTo: to, filter: () => false, add, sort: true });
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
