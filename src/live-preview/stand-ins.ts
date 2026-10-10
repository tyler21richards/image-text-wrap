// Keeps wrapping correct when CodeMirror stops drawing a wrapped image's own line (brief 7 item 6). TODO.
import type { Extension } from '@codemirror/state';
import type ImageTextWrapPlugin from '../main';

export function standInExtension(_plugin: ImageTextWrapPlugin): Extension {
	return [];
}
