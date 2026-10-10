// Picture toolbar shown above the selected image in Live Preview (brief 4.1). TODO: implement.
import type { Extension } from '@codemirror/state';
import type ImageTextWrapPlugin from '../main';

export function toolbarExtension(_plugin: ImageTextWrapPlugin): Extension {
	return [];
}

/** Removes every toolbar element from every window (plugin unload). */
export function destroyToolbars(): void {}
