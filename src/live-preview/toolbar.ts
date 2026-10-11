// Picture toolbar shown above the image Obsidian has selected in Live Preview (brief 4.1), and on phones
// and tablets a sheet docked at the bottom of the screen instead (brief M5, toolbar-sheet.ts).
//
// Obsidian marks the selected image with .is-selected and keeps that selection through edits that only
// rewrite the link, so the toolbar follows that class: a MutationObserver on the editor's content (class
// changes) plus every editor update. All DOM reads happen in CodeMirror's measure phase.
import type { Extension, Text } from '@codemirror/state';
import { ViewPlugin, type EditorView, type PluginValue, type ViewUpdate } from '@codemirror/view';
import { Platform, editorInfoField, type MarkdownFileInfo } from 'obsidian';
import { NATIVE_CONTROLS, pictureOf, selectedImage } from '../dom';
import { locateEmbed, type LocatedLink } from '../edit/locate';
import type { Gap, Layout } from '../grammar';
import { registerIcons } from '../icons';
import type ImageTextWrapPlugin from '../main';
import {
	keyboardShown,
	placeToolbar,
	revealScroll,
	revealTop,
	sheetBottom,
	sheetTop,
	visiblePart,
	type Box,
	type Placement,
} from '../ui/place-toolbar';
import { PictureToolbar, type LayoutPanel, type ToolbarHost, type ToolbarSubject } from './toolbar-dom';
import { DOUBLE_TAP_WAIT, PictureSheet, ScreenWatch, measureHeader, measureScreen } from './toolbar-sheet';
import { keepScrollExtension, releaseScrollPosition } from './keep-scroll';
import { isLivePreview, writeLayout } from './toolbar-target';

/** Space between the picture and the toolbar, and between the toolbar and the scroller's edges. */
const GAP = 8;
const MARGIN = 4;
/** On phones and tablets: space between the sheet and the bars or keyboard below it, and kept around the picture it reveals. */
const SHEET_GAP = 8;
/**
 * On phones and tablets: how much of the note the sheet leaves visible below the note's header at least (two
 * rows of 44 px). With less room, as with the keyboard up on a phone in landscape, the sheet would hide the
 * whole note or run off the screen, so it hides until the keyboard goes.
 */
const NOTE_ROOM = 88;

const toolbars = new Map<Document, PictureToolbar>();
const sheets = new Map<Document, PictureSheet>();

function toolbarFor(doc: Document): PictureToolbar {
	let toolbar = toolbars.get(doc);
	if (!toolbar) {
		toolbar = new PictureToolbar(doc);
		toolbars.set(doc, toolbar);
	}
	return toolbar;
}

function sheetFor(doc: Document): PictureSheet {
	let sheet = sheets.get(doc);
	if (!sheet) {
		sheet = new PictureSheet(doc);
		sheets.set(doc, sheet);
	}
	return sheet;
}

/** Removes every toolbar and sheet element from every window (plugin unload). */
export function destroyToolbars(): void {
	for (const toolbar of toolbars.values()) toolbar.destroy();
	toolbars.clear();
	for (const sheet of sheets.values()) sheet.destroy();
	sheets.clear();
}

const liveViews = new Set<ToolbarView>();

/** Re-checks every editor's toolbar now, e.g. after the "show toolbar" setting changed. */
export function refreshToolbars(): void {
	for (const v of liveViews) v.recheck();
}

/** The CodeMirror view behind an Obsidian editor (commands only get the Editor and its view). */
export function viewOfEditor(info: MarkdownFileInfo): EditorView | null {
	for (const v of liveViews) {
		if (v.view.state.field(editorInfoField, false) === info) return v.view;
	}
	return null;
}

function box(r: DOMRect): Box {
	return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
}

/** CodeMirror's measure request (the type itself is not exported). */
interface MeasureRequest<T> {
	key: unknown;
	read(view: EditorView): T;
	write(measure: T, view: EditorView): void;
}

interface Measured {
	toolbar: PictureToolbar;
	embed: HTMLElement;
	subject: ToolbarSubject;
	placement: Placement | null;
}

/** Phones and tablets: where the sheet goes, and how far to scroll so it does not cover the picture. */
interface SheetMeasured {
	sheet: PictureSheet;
	embed: HTMLElement;
	subject: ToolbarSubject;
	/** The sheet's bottom edge, in px above the bottom of the window. */
	bottom: number;
	/** How far to scroll the note to show the picture above the sheet (0 when it does not cover the picture). */
	reveal: number;
}

/** Phones and tablets: a reveal waiting until the second tap of a double tap can no longer come. */
interface PendingReveal {
	/** The start of the picture's link. */
	from: number;
	timer: number;
	/** The wait is over: the next write scrolls. */
	due: boolean;
}

class ToolbarView implements PluginValue, ToolbarHost {
	private readonly request: MeasureRequest<Measured | null>;
	private readonly sheetRequest: MeasureRequest<SheetMeasured | null>;
	/** Phones and tablets show the sheet instead of the floating toolbar. Obsidian decides this at startup. */
	private readonly mobile = Platform.isMobile;
	/** Phones and tablets: what moves the sheet or the note on screen. */
	private readonly screen: ScreenWatch | null = null;
	private readonly classes: MutationObserver;
	private resizes: ResizeObserver | null = null;
	private watched: HTMLElement | null = null;
	/** The toolbar or sheet this view is showing, if any, and the start of the link it shows. */
	private shownOn: LayoutPanel | null = null;
	private shownFrom: number | null = null;
	/** Cache: locating a link scans the note, so do it once per (image, note text). */
	private located: { embed: HTMLElement; doc: Text; result: LocatedLink | null } | null = null;
	/** Start of the link whose toolbar the user closed with Esc; it stays closed until the selection changes. */
	private dismissedAt: number | null = null;
	/**
	 * Phones and tablets: start of the link whose picture has been scrolled clear of the sheet, which happens
	 * once per tap on it (and again after a rotation). Scrolling it back under the sheet afterwards is the
	 * user's choice.
	 */
	private revealedAt: number | null = null;
	/** Phones and tablets: that scroll, while it waits for a double tap's second tap (writeSheet). */
	private pendingReveal: PendingReveal | null = null;
	/** Phones and tablets: the window's width when last seen. A new width is a rotation; a keyboard changes only the height. */
	private width: number;
	/** A measure request queued before destroy() may still run; it must not show the toolbar again. */
	private destroyed = false;

	constructor(
		readonly view: EditorView,
		private readonly plugin: ImageTextWrapPlugin,
	) {
		this.request = { key: this, read: () => this.read(), write: (m) => this.write(m) };
		this.sheetRequest = { key: this, read: () => this.readSheet(), write: (m) => this.writeSheet(m) };
		this.classes = new MutationObserver(() => this.schedule());
		this.classes.observe(view.contentDOM, { attributes: true, attributeFilter: ['class'], subtree: true });
		view.scrollDOM.addEventListener('scroll', this.schedule, { capture: true, passive: true });
		view.scrollDOM.addEventListener('wheel', this.onWheel, { capture: true, passive: true });
		// On the scroller, so a press on its scrollbar counts too.
		view.scrollDOM.addEventListener('pointerdown', this.onPointerDown, true);
		view.contentDOM.addEventListener('load', this.schedule, true);
		view.dom.addEventListener('keydown', this.onKeyDown, true);
		this.width = view.dom.win.innerWidth;
		if (this.mobile) {
			this.screen = new ScreenWatch(view.scrollDOM, { changed: this.onScreenChange, keydown: this.onWindowKeyDown, tapped: this.onTap });
		}
		liveViews.add(this);
		this.schedule();
	}

	get defaultGap(): Gap {
		return this.plugin.settings.defaultGap;
	}

	update(update: ViewUpdate): void {
		if (update.docChanged) {
			if (this.dismissedAt !== null) this.dismissedAt = update.changes.mapPos(this.dismissedAt, 1);
			// Kept at the start of its link when a layout change rewrites the link.
			if (this.revealedAt !== null) this.revealedAt = update.changes.mapPos(this.revealedAt, -1);
			if (this.pendingReveal) this.pendingReveal.from = update.changes.mapPos(this.pendingReveal.from, -1);
			this.located = null;
		}
		this.schedule();
	}

	readonly schedule = (): void => {
		// The toolbar element is made here, outside the measure phase, which must not change the DOM.
		if (this.plugin.settings.showToolbar && this.view.dom.isConnected) {
			if (this.mobile) sheetFor(this.view.dom.doc);
			else toolbarFor(this.view.dom.doc);
		}
		if (this.mobile) this.view.requestMeasure(this.sheetRequest);
		else this.view.requestMeasure(this.request);
	};

	/** After a workspace change: hide at once if this editor is no longer the active one, else re-measure. */
	recheck(): void {
		if (!this.plugin.settings.showToolbar || !this.isActiveEditor() || !this.isVisible()) this.release();
		else this.schedule();
	}

	private isActiveEditor(): boolean {
		const info = this.view.state.field(editorInfoField, false);
		return !!info && this.plugin.app.workspace.activeEditor === info;
	}

	private isVisible(): boolean {
		return this.view.dom.isConnected && this.view.scrollDOM.offsetHeight > 0;
	}

	private locate(embed: HTMLElement): LocatedLink | null {
		const doc = this.view.state.doc;
		const cached = this.located;
		if (cached && cached.embed === embed && cached.doc === doc) return cached.result;
		const result = locateEmbed(this.view, embed);
		this.located = { embed, doc, result };
		return result;
	}

	/** The selected image and its link, when the toolbar or sheet may show for it (measure phase). */
	private selection(): { embed: HTMLElement; located: LocatedLink } | null {
		const view = this.view;
		if (this.destroyed || !this.plugin.settings.showToolbar || !isLivePreview(view) || view.state.readOnly) return null;
		if (!this.isVisible() || !this.isActiveEditor()) return null;
		const embed = selectedImage(view);
		if (!embed) {
			this.dismissedAt = null;
			return null;
		}
		const located = this.locate(embed);
		if (!located || located.unsupported || this.dismissedAt === located.link.from) return null;
		return { embed, located };
	}

	private read(): Measured | null {
		const view = this.view;
		const selected = this.selection();
		if (!selected) return null;
		const { embed, located } = selected;

		const toolbar = toolbars.get(view.dom.doc);
		if (!toolbar) return null;
		const win = view.dom.win;
		const scroller = view.scrollDOM.getBoundingClientRect();
		const visible: Box = {
			left: Math.max(scroller.left, 0),
			top: Math.max(scroller.top, 0),
			right: Math.min(scroller.right, win.innerWidth),
			bottom: Math.min(scroller.bottom, win.innerHeight),
		};
		let picture = pictureOf(embed).getBoundingClientRect();
		if (picture.width === 0 || picture.height === 0) picture = embed.getBoundingClientRect();
		const avoid = Array.from(embed.querySelectorAll<HTMLElement>(NATIVE_CONTROLS))
			.map((el) => el.getBoundingClientRect())
			.filter((r) => r.width > 0 && r.height > 0)
			.map(box);
		const placement = placeToolbar({
			image: box(picture),
			visible,
			column: box(view.contentDOM.getBoundingClientRect()),
			width: toolbar.el.offsetWidth,
			height: toolbar.el.offsetHeight,
			avoid,
			gap: GAP,
			margin: MARGIN,
		});
		return {
			toolbar,
			embed,
			subject: { from: located.link.from, layout: located.link.layout, doc: view.state.doc },
			placement,
		};
	}

	private write(m: Measured | null): void {
		if (!m || !m.placement || this.destroyed) {
			this.release();
			return;
		}
		if (this.shownOn && this.shownOn !== m.toolbar) this.release();
		m.toolbar.host = this;
		m.toolbar.render(m.subject);
		m.toolbar.showAt(m.placement);
		this.shownOn = m.toolbar;
		this.shownFrom = m.subject.from;
		this.watch(m.embed);
	}

	/**
	 * Phones and tablets: the sheet sits above the keyboard and Obsidian's bars, and shows while any of the
	 * picture is on screen (above the keyboard, below the note's header), also behind the sheet itself, and
	 * while it fits on screen below the header (sheetTop).
	 */
	private readSheet(): SheetMeasured | null {
		const view = this.view;
		const selected = this.selection();
		if (!selected) return null;
		const { embed, located } = selected;
		const sheet = sheets.get(view.dom.doc);
		if (!sheet) return null;

		const win = view.dom.win;
		const scroller = view.scrollDOM.getBoundingClientRect();
		// A phone's sidebar slides the whole note aside: the sheet goes away with it. (A tablet's floats over
		// the note, and over the sheet, which is drawn below Obsidian's sidebars.)
		if (scroller.left < -1 || scroller.right > win.innerWidth + 1) return null;
		const screen = measureScreen(view.dom.doc, SHEET_GAP);
		const header = measureHeader(view.scrollDOM, keyboardShown(screen));
		const keyboardTop = Math.min(
			screen.height - screen.keyboard,
			screen.visual ? screen.visual.top + screen.visual.height : Infinity,
		);
		const visible: Box = {
			left: Math.max(scroller.left, 0),
			top: Math.max(scroller.top, 0, header.bottom),
			right: Math.min(scroller.right, win.innerWidth),
			bottom: Math.min(scroller.bottom, keyboardTop),
		};
		let picture = pictureOf(embed).getBoundingClientRect();
		if (picture.width === 0 || picture.height === 0) picture = embed.getBoundingClientRect();
		if (!visiblePart(box(picture), visible)) return null;

		const top = sheetTop(screen, sheet.el.offsetHeight, header, NOTE_ROOM);
		if (top === null) return null;
		return {
			sheet,
			embed,
			subject: { from: located.link.from, layout: located.link.layout, doc: view.state.doc },
			bottom: sheetBottom(screen),
			reveal: revealScroll(box(picture), revealTop(screen, header, scroller.top), top, SHEET_GAP),
		};
	}

	private writeSheet(m: SheetMeasured | null): void {
		if (!m || this.destroyed) {
			this.release();
			return;
		}
		if (this.shownOn && this.shownOn !== m.sheet) this.release();
		m.sheet.host = this;
		m.sheet.render(m.subject);
		m.sheet.showAt(m.bottom);
		this.shownOn = m.sheet;
		this.shownFrom = m.subject.from;
		this.watch(m.embed);
		// Once per tap on a picture (and after a rotation): a picture the sheet would cover scrolls up into
		// view. Not at once: the second tap of a double tap must find the picture where the first one did (it
		// opens Obsidian's viewer there), so the scroll waits until such a tap can no longer come, and a press
		// on the note meanwhile (that tap, or the start of a scroll) calls it off. A write keeps the view still
		// (writeLayout), and scrolling the note afterwards is left alone.
		const from = m.subject.from;
		const pending = this.pendingReveal;
		if (this.revealedAt !== from) {
			this.revealedAt = from;
			this.cancelReveal();
			if (m.reveal > 0) this.revealLater(from);
		} else if (pending && pending.due && pending.from === from) {
			this.pendingReveal = null;
			if (m.reveal > 0) {
				const still = this.view.dom.win.matchMedia('(prefers-reduced-motion: reduce)').matches;
				this.view.scrollDOM.scrollBy({ top: m.reveal, behavior: still ? 'auto' : 'smooth' });
			}
		}
	}

	/** Phones and tablets: scrolls the picture of the link at `from` clear of the sheet in DOUBLE_TAP_WAIT ms, measured afresh then. */
	private revealLater(from: number): void {
		const pending: PendingReveal = { from, timer: 0, due: false };
		pending.timer = this.view.dom.win.setTimeout(() => {
			if (this.pendingReveal !== pending || this.destroyed) return;
			pending.due = true;
			this.view.requestMeasure(this.sheetRequest);
		}, DOUBLE_TAP_WAIT);
		this.pendingReveal = pending;
	}

	private cancelReveal(): void {
		if (!this.pendingReveal) return;
		this.view.dom.win.clearTimeout(this.pendingReveal.timer);
		this.pendingReveal = null;
	}

	/** Hides the toolbar if this view is the one showing it. */
	private release(): void {
		this.cancelReveal();
		this.watch(null);
		const toolbar = this.shownOn;
		this.shownOn = null;
		this.shownFrom = null;
		if (toolbar && toolbar.host === this) {
			toolbar.hide();
			toolbar.host = null;
		}
	}

	/**
	 * Follows the picture's size, so the toolbar keeps up while Obsidian's resize corner is dragged, and the
	 * editor's, so it keeps up while a sidebar opening or closing slides the note column across. CodeMirror
	 * measures such a slide only every 50 ms or so, which left the toolbar behind for several frames.
	 */
	private watch(embed: HTMLElement | null): void {
		if (embed === this.watched) return;
		this.resizes?.disconnect();
		this.resizes = null;
		this.watched = embed;
		if (!embed) return;
		// The observer of the image's own window, so a pop-out window delivers its notifications.
		const Observer = (embed.win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver ?? ResizeObserver;
		this.resizes = new Observer(this.onResize);
		this.resizes.observe(pictureOf(embed));
		this.resizes.observe(this.view.scrollDOM);
	}

	/**
	 * Places the toolbar at once: resize notifications come after layout and before paint, so the rectangles
	 * read here are the ones about to be painted, and the toolbar moves in the same frame as the picture.
	 * The writes only touch the toolbar, which nothing here observes.
	 */
	private readonly onResize = (): void => {
		if (this.destroyed) return;
		if (this.mobile) this.writeSheet(this.readSheet());
		else this.write(this.read());
	};

	apply(subject: ToolbarSubject, layout: Layout): void {
		writeLayout(this.view, subject.from, layout, subject.doc);
	}

	dismiss(): void {
		if (this.shownFrom === null) return;
		this.dismissedAt = this.shownFrom;
		this.release();
	}

	private readonly onKeyDown = (e: KeyboardEvent): void => {
		releaseScrollPosition(this.view);
		// Hide the toolbar, but let Esc reach Obsidian and CodeMirror as usual. An Esc that closes a menu
		// (the Spacing dropdown, the image's right-click menu) only does that.
		if (e.key === 'Escape' && this.shownOn && !this.shownOn.keyAlreadyUsed(e)) this.dismiss();
	};

	private readonly onPointerDown = (): void => {
		releaseScrollPosition(this.view);
		// A new click in the note brings a dismissed toolbar back.
		this.dismissedAt = null;
		// Phones and tablets: a double tap's second tap, or the start of a scroll, calls off a waiting reveal.
		this.cancelReveal();
	};

	private readonly onWheel = (): void => {
		releaseScrollPosition(this.view);
	};

	/**
	 * Phones and tablets: Esc from a hardware keyboard with the focus outside the editor. From inside it,
	 * onKeyDown has already dismissed the sheet, and this finds nothing shown.
	 */
	private readonly onWindowKeyDown = (e: KeyboardEvent): void => {
		if (e.key === 'Escape' && this.shownOn && !this.shownOn.keyAlreadyUsed(e)) this.dismiss();
	};

	/** Phones and tablets: a tap in the note (a scroll makes no click), which may select a picture anew. */
	private readonly onTap = (): void => {
		this.revealedAt = null;
		this.schedule();
	};

	/**
	 * Phones and tablets: something that places the sheet or the note may have changed. A rotation (a new
	 * window width) moves both, so the picture is revealed again; a keyboard opening (only the height
	 * changes) does not do that.
	 */
	private readonly onScreenChange = (): void => {
		const width = this.view.dom.win.innerWidth;
		if (width !== this.width) {
			this.width = width;
			this.revealedAt = null;
		}
		this.schedule();
	};

	destroy(): void {
		this.destroyed = true;
		this.screen?.destroy();
		this.classes.disconnect();
		this.view.scrollDOM.removeEventListener('scroll', this.schedule, { capture: true });
		this.view.scrollDOM.removeEventListener('wheel', this.onWheel, { capture: true });
		this.view.scrollDOM.removeEventListener('pointerdown', this.onPointerDown, true);
		this.view.contentDOM.removeEventListener('load', this.schedule, true);
		this.view.dom.removeEventListener('keydown', this.onKeyDown, true);
		this.release();
		liveViews.delete(this);
	}
}

export function toolbarExtension(plugin: ImageTextWrapPlugin): Extension {
	registerIcons(plugin);
	const { workspace } = plugin.app;
	plugin.registerEvent(workspace.on('active-leaf-change', refreshToolbars));
	plugin.registerEvent(workspace.on('layout-change', refreshToolbars));
	plugin.registerEvent(workspace.on('css-change', refreshToolbars));
	plugin.registerEvent(
		workspace.on('window-close', (win) => {
			toolbars.get(win.doc)?.destroy();
			toolbars.delete(win.doc);
			sheets.get(win.doc)?.destroy();
			sheets.delete(win.doc);
		}),
	);
	return [ViewPlugin.define((view) => new ToolbarView(view, plugin)), keepScrollExtension()];
}
