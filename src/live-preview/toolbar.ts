// Picture toolbar shown above the image Obsidian has selected in Live Preview (brief 4.1).
//
// Obsidian marks the selected image with .is-selected and keeps that selection through edits that only
// rewrite the link, so the toolbar follows that class: a MutationObserver on the editor's content (class
// changes) plus every editor update. All DOM reads happen in CodeMirror's measure phase.
import type { Extension, Text } from '@codemirror/state';
import { ViewPlugin, type EditorView, type PluginValue, type ViewUpdate } from '@codemirror/view';
import { editorInfoField, type MarkdownFileInfo } from 'obsidian';
import { NATIVE_CONTROLS, pictureOf, selectedImage } from '../dom';
import { locateEmbed, type LocatedLink } from '../edit/locate';
import type { Gap, Layout } from '../grammar';
import { registerIcons } from '../icons';
import type ImageTextWrapPlugin from '../main';
import { placeToolbar, type Box, type Placement } from '../ui/place-toolbar';
import { PictureToolbar, type ToolbarHost, type ToolbarSubject } from './toolbar-dom';
import { keepScrollExtension, releaseScrollPosition } from './keep-scroll';
import { isLivePreview, writeLayout } from './toolbar-target';

/** Space between the picture and the toolbar, and between the toolbar and the scroller's edges. */
const GAP = 8;
const MARGIN = 4;

const toolbars = new Map<Document, PictureToolbar>();

function toolbarFor(doc: Document): PictureToolbar {
	let toolbar = toolbars.get(doc);
	if (!toolbar) {
		toolbar = new PictureToolbar(doc);
		toolbars.set(doc, toolbar);
	}
	return toolbar;
}

/** Removes every toolbar element from every window (plugin unload). */
export function destroyToolbars(): void {
	for (const toolbar of toolbars.values()) toolbar.destroy();
	toolbars.clear();
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

class ToolbarView implements PluginValue, ToolbarHost {
	private readonly request: MeasureRequest<Measured | null>;
	private readonly classes: MutationObserver;
	private resizes: ResizeObserver | null = null;
	private watched: HTMLElement | null = null;
	/** The toolbar this view is showing, if any, and the start of the link it shows. */
	private shownOn: PictureToolbar | null = null;
	private shownFrom: number | null = null;
	/** Cache: locating a link scans the note, so do it once per (image, note text). */
	private located: { embed: HTMLElement; doc: Text; result: LocatedLink | null } | null = null;
	/** Start of the link whose toolbar the user closed with Esc; it stays closed until the selection changes. */
	private dismissedAt: number | null = null;
	/** A measure request queued before destroy() may still run; it must not show the toolbar again. */
	private destroyed = false;

	constructor(
		readonly view: EditorView,
		private readonly plugin: ImageTextWrapPlugin,
	) {
		this.request = { key: this, read: () => this.read(), write: (m) => this.write(m) };
		this.classes = new MutationObserver(() => this.schedule());
		this.classes.observe(view.contentDOM, { attributes: true, attributeFilter: ['class'], subtree: true });
		view.scrollDOM.addEventListener('scroll', this.schedule, { capture: true, passive: true });
		view.scrollDOM.addEventListener('wheel', this.onWheel, { capture: true, passive: true });
		// On the scroller, so a press on its scrollbar counts too.
		view.scrollDOM.addEventListener('pointerdown', this.onPointerDown, true);
		view.contentDOM.addEventListener('load', this.schedule, true);
		view.dom.addEventListener('keydown', this.onKeyDown, true);
		liveViews.add(this);
		this.schedule();
	}

	get defaultGap(): Gap {
		return this.plugin.settings.defaultGap;
	}

	update(update: ViewUpdate): void {
		if (update.docChanged) {
			if (this.dismissedAt !== null) this.dismissedAt = update.changes.mapPos(this.dismissedAt, 1);
			this.located = null;
		}
		this.schedule();
	}

	readonly schedule = (): void => {
		// The toolbar element is made here, outside the measure phase, which must not change the DOM.
		if (this.plugin.settings.showToolbar && this.view.dom.isConnected) toolbarFor(this.view.dom.doc);
		this.view.requestMeasure(this.request);
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

	private read(): Measured | null {
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

	/** Hides the toolbar if this view is the one showing it. */
	private release(): void {
		this.watch(null);
		const toolbar = this.shownOn;
		this.shownOn = null;
		this.shownFrom = null;
		if (toolbar && toolbar.host === this) {
			toolbar.hide();
			toolbar.host = null;
		}
	}

	/** Follows the picture's size, so the toolbar keeps up while Obsidian's resize corner is dragged. */
	private watch(embed: HTMLElement | null): void {
		if (embed === this.watched) return;
		this.resizes?.disconnect();
		this.resizes = null;
		this.watched = embed;
		if (!embed) return;
		// The observer of the image's own window, so a pop-out window delivers its notifications.
		const Observer = (embed.win as Window & { ResizeObserver?: typeof ResizeObserver }).ResizeObserver ?? ResizeObserver;
		this.resizes = new Observer(this.schedule);
		this.resizes.observe(pictureOf(embed));
	}

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
		// Hide the toolbar, but let Esc reach Obsidian and CodeMirror as usual.
		if (e.key === 'Escape' && this.shownOn) this.dismiss();
	};

	private readonly onPointerDown = (): void => {
		releaseScrollPosition(this.view);
		// A new click in the note brings a dismissed toolbar back.
		this.dismissedAt = null;
	};

	private readonly onWheel = (): void => {
		releaseScrollPosition(this.view);
	};

	destroy(): void {
		this.destroyed = true;
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
		}),
	);
	return [ViewPlugin.define((view) => new ToolbarView(view, plugin)), keepScrollExtension()];
}
