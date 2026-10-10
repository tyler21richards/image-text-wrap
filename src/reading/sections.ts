// The section elements of a Reading view, including the ones Obsidian keeps off the page.
//
// Obsidian's Reading view renders a note as one element per block ("section") and only keeps the
// sections near the screen in the page. Its renderer lists every section, attached or not, in
// `previewMode.renderer.sections[].el`. That list is not public API, so it is read behind a type
// check and a try/catch; without it the attached sections are found in the page and the caller
// falls back to the public `previewMode.rerender(true)` for the rest.
//
// The guarded accessor follows Adjustable Media (src/view/obsidianInternals.ts, readingSectionsOfView),
// MIT, (c) 2026 Yi-luo-hua.
import type { MarkdownView } from 'obsidian';
import { READING_PUSHER, READING_SIZER, READING_UI_SECTION, isElement } from '../dom';

interface RendererLike {
	sections?: unknown;
	sizerEl?: unknown;
	applyScrollDelayed?: unknown;
}

/** The element that holds the sections of the Reading view of `view` (Obsidian's "sizer"). */
export function sizerOf(view: MarkdownView): HTMLElement | null {
	try {
		const sizer = (view.previewMode as unknown as { renderer?: RendererLike }).renderer?.sizerEl;
		if (isElement(sizer)) return sizer;
	} catch {
		/* fall back to the page */
	}
	return view.previewMode.containerEl.querySelector<HTMLElement>(`.markdown-preview-view > ${READING_SIZER}`);
}

/** Every section element the Reading view of `view` has, or null when its renderer is not what we know. */
export function allSectionEls(view: MarkdownView): HTMLElement[] | null {
	try {
		const renderer = (view.previewMode as unknown as { renderer?: RendererLike }).renderer;
		const sections = renderer?.sections;
		if (!Array.isArray(sections)) return null;
		const out: HTMLElement[] = [];
		for (const section of sections) {
			const el = (section as { el?: unknown } | null)?.el;
			if (!isElement(el)) return null;
			if (!el.hasClass(READING_UI_SECTION)) out.push(el);
		}
		return out;
	} catch {
		return null;
	}
}

/**
 * The heights Obsidian keeps for the sections of the Reading view of `view`, by element. It places
 * the sections it has taken off the page by these, so a section re-rendered off the page with another
 * height moves everything below it. Empty when its renderer is not what we know.
 */
export function sectionHeights(view: MarkdownView): Map<HTMLElement, number> {
	const out = new Map<HTMLElement, number>();
	try {
		const sections = (view.previewMode as unknown as { renderer?: RendererLike }).renderer?.sections;
		if (!Array.isArray(sections)) return out;
		for (const section of sections) {
			const { el, height } = (section ?? {}) as { el?: unknown; height?: unknown };
			if (isElement(el) && typeof height === 'number' && Number.isFinite(height)) out.set(el, height);
		}
	} catch {
		/* nothing known */
	}
	return out;
}

/**
 * Renders every section of the Reading view of `view` again, which also measures them again. Obsidian's
 * rerender(true) empties the sections first, which loses the reader's place (measured: 2200px down
 * Fixture.md, the view landed 830px higher). So a shown view gets back to `scroll` (its getScroll(),
 * taken before anything changed) once the render is done, the way Obsidian does after a resize
 * (renderer.applyScrollDelayed); a hidden one is placed by Obsidian when it is shown. Without that
 * method a shown view is left alone: a later jump is better than losing the place. False then.
 */
export function rerenderInPlace(view: MarkdownView, scroll: number | null): boolean {
	const preview = view.previewMode;
	try {
		if (scroll === null) {
			preview.rerender(true);
			return true;
		}
		const renderer = (preview as unknown as { renderer?: RendererLike }).renderer;
		const restore = renderer?.applyScrollDelayed;
		if (typeof restore !== 'function') return false;
		preview.rerender(true);
		(restore as (scroll: number) => void).call(renderer, scroll);
		return true;
	} catch {
		return false;
	}
}

/**
 * The section elements of the Reading view of `view` that are in the page right now (the note's own,
 * not those of a note transcluded into it).
 */
export function attachedSectionEls(view: MarkdownView): HTMLElement[] {
	const sizer = sizerOf(view);
	if (!sizer) return [];
	return (Array.from(sizer.children) as HTMLElement[]).filter(
		(el) => el.instanceOf(HTMLDivElement) && !el.hasClass(READING_UI_SECTION) && !el.hasClass(READING_PUSHER),
	);
}
