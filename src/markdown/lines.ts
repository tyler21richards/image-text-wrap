// A one-pass line scanner for the parts of Markdown this plugin cares about. Pure, no Obsidian imports.
// It decides, for every line of a note, what context it is in (body text, code, math, comment,
// frontmatter), what kind of line it is, and whether a new top-level block starts there.

export type LineContext = 'text' | 'code' | 'math' | 'comment' | 'frontmatter';
export type LineKind =
	| 'blank'
	| 'heading'
	| 'setext-underline'
	| 'list' // a list item, or a line that continues one without its marker (a lazy line)
	| 'quote' // a quote or callout line, or a line that continues one without its ">"
	| 'footnote' // a footnote definition ("[^1]: …"), or a line that continues one
	| 'table'
	| 'hr'
	| 'indented'
	| 'paragraph'
	| 'fence' // the opening or closing line of fenced code
	| 'math-fence' // the opening or closing line of a $$ block
	| 'comment-fence'
	| 'frontmatter-fence'
	| 'inside'; // a line inside code, math, a comment or frontmatter

export interface LineInfo {
	context: LineContext;
	kind: LineKind;
	/** A top-level block (paragraph, heading, list, quote, table, code, math, rule) starts on this line. */
	startsBlock: boolean;
}

const HEADING = /^#{1,6}(?:[ \t]|$)/;
const LIST = /^(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/;
/** A list item: its marker, the spaces after it, and its first line of content. */
const LIST_ITEM = /^((?:[-*+]|\d{1,9}[.)]))([ \t]*)(.*)$/;
const QUOTE = /^ {0,3}>/;
const FOOTNOTE = /^\[\^[^\]]+\]:/;
/** One to three spaces: in CommonMark they do not change what a line is (outside a list). */
const SHALLOW = /^ {1,3}(?![ \t])/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const SETEXT = /^ {0,3}(?:=+|-+)[ \t]*$/;
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?\s*$/;

function countOf(text: string, token: string): number {
	let n = 0;
	for (let i = text.indexOf(token); i !== -1; i = text.indexOf(token, i + token.length)) n++;
	return n;
}

const isBlank = (s: string): boolean => s.trim() === '';

/** The column the content of a list item starts at, for a line that holds one (`indent` spaces in). */
function listContentColumn(line: string, indent: number): number {
	const m = LIST_ITEM.exec(line.slice(indent));
	if (!m) return indent + 2;
	const spaces = m[2]!.length;
	return indent + m[1]!.length + (m[3] === '' || spaces > 4 ? 1 : Math.max(1, spaces));
}

export function scanLines(lines: readonly string[]): LineInfo[] {
	const out: LineInfo[] = [];
	let i = 0;

	// Frontmatter: "---" on the very first line, closed by "---" or "...".
	if (lines.length > 1 && lines[0]!.trimEnd() === '---') {
		let end = -1;
		for (let j = 1; j < lines.length; j++) {
			const t = lines[j]!.trimEnd();
			if (t === '---' || t === '...') {
				end = j;
				break;
			}
		}
		if (end !== -1) {
			for (let j = 0; j <= end; j++) {
				out.push({
					context: 'frontmatter',
					kind: j === 0 || j === end ? 'frontmatter-fence' : 'inside',
					startsBlock: false,
				});
			}
			i = end + 1;
		}
	}

	let inTable = false;
	let inList = false;
	// Where the content of the open list's items starts: a line indented less, after a blank line, ends it.
	let listIndent = 0;
	// The container (list item, quote, footnote) that the next line continues if it has no marker of its
	// own: Reading view puts such a "lazy" line inside the container, even after an empty list item or a
	// heading in a quote (measured on 1.14.4).
	let lazy: 'list' | 'quote' | 'footnote' | null = null;
	const push = (info: LineInfo) => out.push(info);

	for (; i < lines.length; i++) {
		const line = lines[i]!;
		// Kind of the previous line, used to tell block starts from continuations.
		const prevKind: LineKind | 'start' = out[out.length - 1]?.kind ?? 'start';

		// Fenced code.
		const fence = line.match(FENCE_OPEN);
		if (fence && !QUOTE.test(line)) {
			const marker = fence[1]!;
			const startsBlock = prevKind !== 'indented' || !inList;
			push({ context: 'code', kind: 'fence', startsBlock: startsBlock && !/^[ \t]/.test(line) });
			let j = i + 1;
			for (; j < lines.length; j++) {
				const t = lines[j]!;
				const close = t.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/);
				if (close && close[1]![0] === marker[0] && close[1]!.length >= marker.length) break;
				out.push({ context: 'code', kind: 'inside', startsBlock: false });
			}
			if (j < lines.length) out.push({ context: 'code', kind: 'fence', startsBlock: false });
			i = j;
			inTable = inList = false;
			lazy = null;
			continue;
		}

		// Display math: a line starting with $$ that does not close on the same line.
		const trimmed = line.trim();
		if (trimmed.startsWith('$$') && !/^[ \t]/.test(line) && countOf(trimmed, '$$') % 2 === 1) {
			push({ context: 'math', kind: 'math-fence', startsBlock: true });
			let j = i + 1;
			for (; j < lines.length; j++) {
				if (lines[j]!.includes('$$')) break;
				out.push({ context: 'math', kind: 'inside', startsBlock: false });
			}
			if (j < lines.length) out.push({ context: 'math', kind: 'math-fence', startsBlock: false });
			i = j;
			inTable = inList = false;
			lazy = null;
			continue;
		}

		// Comments: %% ... %% and <!-- ... --> spanning lines.
		const opensPercent = trimmed.startsWith('%%') && countOf(trimmed, '%%') % 2 === 1;
		const opensHtml = trimmed.startsWith('<!--') && !trimmed.includes('-->');
		if (opensPercent || opensHtml) {
			const closer = opensPercent ? '%%' : '-->';
			push({ context: 'comment', kind: 'comment-fence', startsBlock: false });
			let j = i + 1;
			for (; j < lines.length; j++) {
				if (lines[j]!.includes(closer)) break;
				out.push({ context: 'comment', kind: 'inside', startsBlock: false });
			}
			if (j < lines.length) out.push({ context: 'comment', kind: 'comment-fence', startsBlock: false });
			i = j;
			inTable = inList = false;
			lazy = null;
			continue;
		}

		const afterBreak =
			prevKind === 'start' ||
			prevKind === 'blank' ||
			prevKind === 'heading' ||
			prevKind === 'setext-underline' ||
			prevKind === 'hr' ||
			prevKind === 'fence' ||
			prevKind === 'math-fence' ||
			prevKind === 'comment-fence' ||
			prevKind === 'frontmatter-fence';

		if (isBlank(line)) {
			push({ context: 'text', kind: 'blank', startsBlock: false });
			inTable = false;
			lazy = null;
			continue;
		}
		// One to three spaces change nothing, except inside a list, where they continue the item (unless,
		// after a blank line, they are fewer than the item's content needs: then the list has ended).
		const shallow = SHALLOW.test(line) && (!inList || (prevKind === 'blank' && line.search(/\S/) < listIndent));
		if (/^[ \t]/.test(line) && !QUOTE.test(line) && !shallow) {
			// Indented code cannot interrupt a paragraph: there, and after a quote or footnote line, the
			// indented line continues it.
			if (!inList && lazy === null && prevKind === 'paragraph') {
				push({ context: 'text', kind: 'paragraph', startsBlock: false });
			} else if (!inList && lazy !== null) {
				push({ context: 'text', kind: lazy, startsBlock: false });
			} else {
				// List continuation, nested list, or indented code. Never a top-level block start.
				push({ context: 'text', kind: 'indented', startsBlock: false });
				lazy = inList ? 'list' : null;
			}
			continue;
		}
		if (shallow) inList = false;
		const body = shallow ? line.trimStart() : line;
		if (HEADING.test(body)) {
			push({ context: 'text', kind: 'heading', startsBlock: true });
			inTable = inList = false;
			lazy = null;
			continue;
		}
		if (prevKind === 'paragraph' && SETEXT.test(line)) {
			push({ context: 'text', kind: 'setext-underline', startsBlock: false });
			continue;
		}
		if (HR.test(line)) {
			push({ context: 'text', kind: 'hr', startsBlock: true });
			inTable = inList = false;
			lazy = null;
			continue;
		}
		if (QUOTE.test(line)) {
			push({ context: 'text', kind: 'quote', startsBlock: prevKind !== 'quote' });
			inTable = inList = false;
			lazy = 'quote';
			continue;
		}
		// Like a link reference definition, a footnote definition cannot interrupt a paragraph: Reading
		// view draws one glued under a paragraph as text (Live Preview still marks the line a footnote).
		if (FOOTNOTE.test(body) && prevKind !== 'paragraph') {
			push({ context: 'text', kind: 'footnote', startsBlock: afterBreak });
			inTable = inList = false;
			lazy = 'footnote';
			continue;
		}
		if (LIST.test(body)) {
			// An item that follows other items (possibly across blank lines) continues the same list.
			let continues = false;
			for (let k = out.length - 1; k >= 0; k--) {
				const o = out[k]!;
				if (o.kind === 'blank') continue;
				continues = o.context === 'text' && (o.kind === 'list' || (o.kind === 'indented' && inList));
				break;
			}
			push({ context: 'text', kind: 'list', startsBlock: !continues });
			inList = true;
			inTable = false;
			listIndent = listContentColumn(line, line.length - body.length);
			lazy = 'list';
			continue;
		}
		if (inTable && line.includes('|')) {
			push({ context: 'text', kind: 'table', startsBlock: false });
			continue;
		}
		const next = lines[i + 1];
		if (line.includes('|') && next !== undefined && TABLE_DELIMITER.test(next) && next.includes('-')) {
			push({ context: 'text', kind: 'table', startsBlock: afterBreak || prevKind !== 'paragraph' });
			inTable = true;
			inList = false;
			lazy = null;
			continue;
		}
		if (lazy !== null) {
			// Continues the paragraph of the list item, quote or footnote above, which keeps it.
			push({ context: 'text', kind: lazy, startsBlock: false });
			continue;
		}
		push({ context: 'text', kind: 'paragraph', startsBlock: afterBreak });
		inList = false;
	}
	return out;
}

const FENCE_MARKS = /```|~~~|\$\$|%%|<!--|-->/;

/**
 * True when a line can open or close code, math or a comment, or frontmatter in a note that starts
 * with "---". Changing such a line can change how every later line of the note is read.
 */
export function opensOrCloses(text: string, frontmatter: boolean): boolean {
	if (FENCE_MARKS.test(text)) return true;
	const t = text.trimEnd();
	return frontmatter && (t === '---' || t === '...');
}

/**
 * True for a line that scanLines reads as a plain paragraph line wherever it stands (or as a line
 * inside code, math, a comment or frontmatter, or one continuing the list item, quote or footnote right
 * above it, as any such line would), and that opens, closes and continues nothing. Changing one such
 * line into another never changes how scanLines reads any other line, so a caller can skip re-scanning
 * the note for that edit.
 */
export function isPlainLine(text: string): boolean {
	if (isBlank(text) || /^[ \t]/.test(text) || text.includes('|') || opensOrCloses(text, true)) return false;
	return !(
		HEADING.test(text) ||
		QUOTE.test(text) ||
		LIST.test(text) ||
		FOOTNOTE.test(text) ||
		HR.test(text) ||
		SETEXT.test(text) ||
		TABLE_DELIMITER.test(text)
	);
}

/**
 * The last line whose reading an edit ending on line `n` can change, besides the line before it (which
 * a table delimiter row turns into a table header). What a line opens carries down to the next blank
 * line (the rows of a table, a setext underline, lines that continue a list item, quote or footnote
 * without its marker), and whether a list is still open carries past that blank line to the indented
 * lines right after it. `text(k)` gives line k, for `n < k <= last`; any numbering works.
 */
export function lastLineAffected(n: number, last: number, text: (k: number) => string): number {
	let k = n + 1;
	while (k <= last && !isBlank(text(k))) k++;
	while (k <= last && (isBlank(text(k)) || /^[ \t]/.test(text(k)))) k++;
	return Math.min(k, last);
}

/**
 * Lines in front of which an image may be dropped: every top-level block start, plus
 * `lines.length` for the end of the note (when the note does not end inside code, math or a comment).
 */
export function dropTargets(lines: readonly string[], infos: readonly LineInfo[] = scanLines(lines)): number[] {
	const out: number[] = [];
	infos.forEach((info, n) => {
		if (info.startsBlock) out.push(n);
	});
	const last = infos[infos.length - 1];
	const endsInside = last && last.context !== 'text' && last.kind === 'inside';
	if (!endsInside) out.push(lines.length);
	return out;
}
