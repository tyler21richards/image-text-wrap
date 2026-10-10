// A one-pass line scanner for the parts of Markdown this plugin cares about. Pure, no Obsidian imports.
// It decides, for every line of a note, what context it is in (body text, code, math, comment,
// frontmatter), what kind of line it is, and whether a new top-level block starts there.

export type LineContext = 'text' | 'code' | 'math' | 'comment' | 'frontmatter';
export type LineKind =
	| 'blank'
	| 'heading'
	| 'setext-underline'
	| 'list'
	| 'quote'
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
const QUOTE = /^ {0,3}>/;
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
			continue;
		}
		if (/^[ \t]/.test(line) && !QUOTE.test(line)) {
			// Indented: list continuation, nested list, or indented code. Never a top-level block start.
			push({ context: 'text', kind: 'indented', startsBlock: false });
			continue;
		}
		if (HEADING.test(line)) {
			push({ context: 'text', kind: 'heading', startsBlock: true });
			inTable = inList = false;
			continue;
		}
		if (prevKind === 'paragraph' && SETEXT.test(line)) {
			push({ context: 'text', kind: 'setext-underline', startsBlock: false });
			continue;
		}
		if (HR.test(line)) {
			push({ context: 'text', kind: 'hr', startsBlock: true });
			inTable = inList = false;
			continue;
		}
		if (QUOTE.test(line)) {
			push({ context: 'text', kind: 'quote', startsBlock: prevKind !== 'quote' });
			inTable = inList = false;
			continue;
		}
		if (LIST.test(line)) {
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
			continue;
		}
		push({ context: 'text', kind: 'paragraph', startsBlock: afterBreak });
		inList = false;
	}
	return out;
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
