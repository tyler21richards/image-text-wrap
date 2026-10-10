// Classes on editor lines that hold a wrapped image, and on the editor when the note has any wrap.
// Rendering itself stays in styles.css; these classes only scope it.
import { RangeSetBuilder, StateField, type Text } from '@codemirror/state';
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view';
import { findImageLinks, ANY_LAYOUT_TOKEN, DEFAULT_GAP, type Layout } from '../grammar';

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

function buildLineDecorations(doc: Text): DecorationSet {
	const builder = new RangeSetBuilder<Decoration>();
	for (let n = 1; n <= doc.lines; n++) {
		const line = doc.line(n);
		if (line.length === 0 || !line.text.includes('![')) continue;
		const layout = soleImageLayout(line.text);
		if (layout) builder.add(line.from, line.from, lineDeco(layout));
	}
	return builder.finish();
}

interface LineState {
	hasWrap: boolean;
	decorations: DecorationSet;
}

/**
 * Kept as a state field over the whole note (not just the viewport) so line heights are the same
 * whether or not a line is on screen, which keeps CodeMirror's height map honest.
 */
export const lineClassField = StateField.define<LineState>({
	create(state) {
		const hasWrap = docHasWrap(state.doc);
		return { hasWrap, decorations: hasWrap ? buildLineDecorations(state.doc) : Decoration.none };
	},
	update(value, tr) {
		if (!tr.docChanged) return value;
		const hasWrap = docHasWrap(tr.state.doc);
		if (!hasWrap) return { hasWrap, decorations: Decoration.none };
		return { hasWrap, decorations: buildLineDecorations(tr.state.doc) };
	},
	provide: (field) => [
		EditorView.decorations.from(field, (v) => v.decorations),
		EditorView.editorAttributes.of((view) =>
			view.state.field(field, false)?.hasWrap ? { class: EDITOR_CLASS } : null,
		),
	],
});
