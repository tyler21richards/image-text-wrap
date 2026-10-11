// Drag to move (brief 4.3, 6.3): press an image in Live Preview (with a finger, press and hold), move it,
// drop it at the start of another block. One ViewPlugin per editor listens for presses on the editor's
// content; everything else lives in the gesture (gesture.ts) for as long as the press lasts.
//
// Listeners go on the editor's DOM directly: CodeMirror hands no events from Obsidian's image widgets
// to extensions. (As in Adjustable Media, src/view/plainDrag.ts, MIT, (c) 2026 Yi-luo-hua.)
import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type PluginValue, type ViewUpdate } from '@codemirror/view';
import { editorLivePreviewField } from 'obsidian';
import { IMAGE_IN_EMBED, editableEmbedFrom, isElement, isNativeControl } from '../../dom';
import { locateEmbed } from '../../edit/locate';
import type ImageTextWrapPlugin from '../../main';
import { ImageDrag } from './gesture';

class DragHandler implements PluginValue {
	private drag: ImageDrag | null = null;

	constructor(
		private readonly view: EditorView,
		private readonly plugin: ImageTextWrapPlugin,
		private readonly live: Set<DragHandler>,
	) {
		live.add(this);
		// Bubble phase, never prevented: Obsidian's click to select, viewer and resize corner keep working.
		view.contentDOM.addEventListener('pointerdown', this.onPointerDown);
		view.contentDOM.addEventListener('dragstart', this.onDragStart, { capture: true });
	}

	update(update: ViewUpdate): void {
		if (this.drag && !update.state.field(editorLivePreviewField, false)) this.cancel();
	}

	destroy(): void {
		this.cancel();
		this.live.delete(this);
		this.view.contentDOM.removeEventListener('pointerdown', this.onPointerDown);
		this.view.contentDOM.removeEventListener('dragstart', this.onDragStart, { capture: true });
	}

	/** Ends a gesture in progress without writing anything. */
	cancel(): void {
		this.drag?.cancel();
		this.drag = null;
	}

	private readonly onPointerDown = (event: PointerEvent): void => {
		const { view } = this;
		// With the setting off nothing is followed, so Obsidian's own image drag works as before.
		if (this.drag || !this.plugin.settings.dragToMove) return;
		if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
		// A finger (a touch, or a pen on a phone or tablet) picks the image up with a long press (gesture.ts); a second
		// finger is not followed.
		if (!event.isPrimary) return;
		if (!view.state.field(editorLivePreviewField, false)) return;
		if (view.state.readOnly || !view.state.facet(EditorView.editable)) return;
		const img = event.target;
		if (!isElement(img) || !img.instanceOf(HTMLImageElement) || !img.matches(IMAGE_IN_EMBED) || isNativeControl(img)) return;
		const embed = editableEmbedFrom(img);
		// Only this editor's own images, not those of an editor nested inside it.
		if (!embed || embed.closest('.cm-content') !== view.contentDOM) return;
		const located = locateEmbed(view, embed);
		if (!located || located.unsupported !== null) return;
		this.drag = new ImageDrag(view, located, embed, img, event, () => {
			this.drag = null;
		});
	};

	// While a press is followed the browser's own image drag must not start: it would take the gesture
	// over. The pressed image is made undraggable for the press (gesture.ts); should a dragstart come anyway,
	// it is stopped on its way down, before it reaches the image, where Obsidian's drag manager would set a
	// grabbing cursor that only a dragend clears (Adjustable Media, docs/DESIGN.md section 4).
	private readonly onDragStart = (event: DragEvent): void => {
		if (!this.drag) return;
		event.preventDefault();
		event.stopPropagation();
	};
}

export function dragExtension(plugin: ImageTextWrapPlugin): Extension {
	const live = new Set<DragHandler>();
	// Editors are reconfigured on unload (which destroys each handler); this also covers a gesture in flight.
	plugin.register(() => {
		for (const handler of live) handler.cancel();
	});
	return ViewPlugin.define((view) => new DragHandler(view, plugin, live));
}
