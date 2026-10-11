// Obsidian's image viewer (the full-window view a second click on a selected image, its Zoom button or a
// click in Reading view opens) titles a picture with the text between its path and its size. For a wrapped
// image that text holds this plugin's layout words, so the title read "wrap-right" or "My dog|wrap-left".
// The viewer has no API, so its title is cleaned where Obsidian draws it: the layout words are left out, and
// a title made only of them becomes the picture's file name, as Obsidian titles a picture with no caption.
// The image in the note keeps its alt text as it is: styles.css reads the layout words there.
//
// Checked against Obsidian 1.14.4 (desktop): the viewer is body > div.lightbox in the window that was active
// when it opened (a pop-out window too). Its title is .lightbox-titlebar-text, written again when the arrow
// keys move to another picture; the picture shown is the last img in .lightbox-media (while it slides in,
// the one it replaces is still there before it). Each img's alt is the title before the file name fallback.
import type { Component } from 'obsidian';
import { isElement } from './dom';
import { isLayoutToken } from './grammar';

const VIEWER_CLASS = 'lightbox';
const VIEWER_TITLE = '.lightbox-titlebar-text';
const VIEWER_PICTURES = '.lightbox-media img';

/** True when one of the "|"-separated parts of `text` is exactly a layout word, as styles.css matches them. */
export function hasLayoutWords(text: string): boolean {
	return text.split('|').some(isLayoutToken);
}

/** `text` without its layout words: the "|"-separated parts that are not exactly one, joined again. */
export function withoutLayoutWords(text: string): string {
	return text
		.split('|')
		.filter((part) => !isLayoutToken(part))
		.join('|');
}

/** The file name at the end of a picture's address, the way Obsidian names a picture with no caption. */
export function fileNameOf(src: string): string {
	if (/^data:/i.test(src)) return '';
	let path: string;
	try {
		path = new URL(src).pathname;
	} catch {
		path = src.split(/[?#]/)[0] ?? '';
	}
	try {
		path = decodeURIComponent(path);
	} catch {
		// A stray "%" in the name: keep it as written.
	}
	return path.slice(path.lastIndexOf('/') + 1);
}

/** The viewer's title for a picture: Obsidian's title without layout words, or the file name if nothing else is left. */
export function viewerTitle(shown: string, src: string): string {
	if (!hasLayoutWords(shown)) return shown;
	return withoutLayoutWords(shown) || fileNameOf(src);
}

/** Cleans one open viewer: its title, and the alt text screen readers read for its pictures. */
function clean(viewer: HTMLElement): void {
	const pictures = Array.from(viewer.querySelectorAll<HTMLImageElement>(VIEWER_PICTURES));
	for (const picture of pictures) {
		const alt = picture.getAttribute('alt');
		if (alt && hasLayoutWords(alt)) picture.setAttribute('alt', withoutLayoutWords(alt));
	}
	const title = viewer.querySelector<HTMLElement>(VIEWER_TITLE);
	if (!title) return;
	const shown = title.textContent ?? '';
	const next = viewerTitle(shown, pictures[pictures.length - 1]?.src ?? '');
	// Only a real change is written, so the write does not wake this observer again and again.
	if (next !== shown) title.setText(next);
}

function isViewer(node: Node): node is HTMLElement {
	return isElement(node) && node.hasClass(VIEWER_CLASS);
}

/** Cleans the title of every image viewer that opens in `doc`, until `owner` unloads. */
export function watchViewerTitles(doc: Document, owner: Component): void {
	// The observer of the viewer's own window, so a pop-out window delivers its notifications.
	const Observer = (doc.win as Window & { MutationObserver?: typeof MutationObserver }).MutationObserver ?? MutationObserver;
	const open = new Map<HTMLElement, MutationObserver>();
	const watch = (viewer: HTMLElement) => {
		if (open.has(viewer)) return;
		// The arrow keys write a new title and swap the picture: clean again after each change.
		const observer = new Observer(() => clean(viewer));
		observer.observe(viewer, { childList: true, characterData: true, subtree: true });
		open.set(viewer, observer);
		clean(viewer);
	};
	const forget = (viewer: HTMLElement) => {
		open.get(viewer)?.disconnect();
		open.delete(viewer);
	};
	const body = new Observer((records) => {
		for (const record of records) {
			for (const node of Array.from(record.addedNodes)) if (isViewer(node)) watch(node);
			for (const node of Array.from(record.removedNodes)) if (isViewer(node)) forget(node);
		}
	});
	body.observe(doc.body, { childList: true });
	for (const node of Array.from(doc.body.children)) if (isViewer(node)) watch(node);
	owner.register(() => {
		body.disconnect();
		for (const observer of open.values()) observer.disconnect();
		open.clear();
	});
}
