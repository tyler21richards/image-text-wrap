// Runs Obsidian's own "Export to PDF" for the active note, without any dialog, and measures the
// print window's DOM right before Chromium prints it.
//
// Technique adapted from Adjustable Media (docs/plans/layout-redesign/probes/w07-final-pdf.js.txt) and
// image-rows-and-wraps (tests/obsidian.mjs, PDF export), both MIT:
// - `remote.dialog` is fetched anew on each read and only cached weakly, so a strong reference is kept
//   while its showSaveDialog is replaced (otherwise the real dialog comes back and blocks the run);
// - window.open is wrapped to reach the print window; its `print-to-pdf` IPC message is the moment the
//   DOM is final, so the measurement runs there, and `open: false` stops the PDF opening in a viewer.
import { existsSync, rmSync, statSync, readFileSync } from 'node:fs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param page      playwright page of the vault window (the note to export must be active)
 * @param dest      absolute path of the PDF to write
 * @param measure   optional function (doc, win, root) => JSON-able, run inside the print window
 * @param settings  pdfExportSettings to use (restored afterwards)
 * @param prepare   optional function (doc, win) run in the print window as soon as it opens
 */
export async function exportPdf(page, { dest, measure, settings, prepare, timeoutMs = 60000 } = {}) {
	if (existsSync(dest)) rmSync(dest);
	await page.evaluate(
		({ dest, measureSrc, prepareSrc, settings }) => {
			const toFn = (src) => (src ? new Function(`return (${src})`)() : null);
			const measure = toFn(measureSrc);
			const prepare = toFn(prepareSrc);
			const electron = window.require('electron');
			const state = (window.__itwPdf = {
				steps: [],
				result: null,
				error: null,
				options: null,
				dialog: electron.remote.dialog, // strong reference, see the header
				savedConfig: app.vault.getConfig('pdfExportSettings'),
				open: window.open,
			});
			state.saveDialog = state.dialog.showSaveDialog;
			state.dialog.showSaveDialog = async () => {
				state.steps.push('dialog');
				return { canceled: false, filePath: dest };
			};
			if (settings) app.vault.setConfig('pdfExportSettings', settings);
			window.open = function (...args) {
				const child = state.open.apply(this, args);
				state.steps.push('window');
				const timer = setInterval(() => {
					try {
						if (!child || child.closed) return clearInterval(timer);
						if (!child.electron?.ipcRenderer) return;
						clearInterval(timer);
						state.steps.push('hooked');
						if (prepare) prepare(child.document, child);
						const ipc = child.electron.ipcRenderer;
						const send = ipc.send;
						ipc.send = function (channel, ...values) {
							if (channel === 'print-to-pdf') {
								state.steps.push('print');
								try {
									if (values[0] && typeof values[0] === 'object') {
										values[0].open = false;
										state.options = { ...values[0] };
									}
									const root = child.document.querySelector('.print .markdown-preview-view') ?? child.document.body;
									if (measure) state.result = measure(child.document, child, root);
								} catch (e) {
									state.error = String(e?.stack ?? e);
								}
							}
							return send.call(this, channel, ...values);
						};
					} catch (e) {
						clearInterval(timer);
						state.error = String(e?.stack ?? e);
					}
				}, 10);
				return child;
			};
		},
		{ dest, measureSrc: measure?.toString() ?? null, prepareSrc: prepare?.toString() ?? null, settings },
	);
	try {
		await page.evaluate(() => {
			// Obsidian opens the export modal in its active window, which does not follow CDP focus.
			window.dispatchEvent(new FocusEvent('focus'));
			if (activeWindow !== window) throw new Error('another Obsidian window is active; close it first');
			const view = app.workspace.activeLeaf.view;
			view.printToPdf();
		});
		// Obsidian's export modal: confirm it.
		for (let i = 0; i < 50; i++) {
			const clicked = await page.evaluate(() => {
				const b = document.querySelector('.modal-container .modal button.mod-cta');
				if (!b) return false;
				b.click();
				return true;
			});
			if (clicked) break;
			await sleep(100);
		}
		// Wait until the file exists and its size is stable.
		let last = -1;
		let stable = 0;
		const t0 = Date.now();
		while (Date.now() - t0 < timeoutMs) {
			if (existsSync(dest)) {
				const size = statSync(dest).size;
				if (size > 1000 && size === last) stable++;
				else stable = 0;
				last = size;
				if (stable >= 3) break;
			}
			await sleep(250);
		}
		const state = await page.evaluate(() => {
			const s = window.__itwPdf;
			return { steps: s.steps, result: s.result, error: s.error, options: s.options };
		});
		const bytes = existsSync(dest) ? readFileSync(dest) : null;
		return {
			...state,
			dest,
			size: bytes?.length ?? 0,
			header: bytes ? bytes.subarray(0, 5).toString('latin1') : null,
		};
	} finally {
		await page.evaluate(() => {
			const s = window.__itwPdf;
			if (!s) return;
			window.open = s.open;
			s.dialog.showSaveDialog = s.saveDialog;
			app.vault.setConfig('pdfExportSettings', s.savedConfig);
			for (let i = 0; i < 3; i++) {
				const modal = document.querySelector('.modal-container');
				if (!modal) break;
				modal.querySelector('.modal-close-button')?.click();
			}
			delete window.__itwPdf;
		});
	}
}

/** Page count of a PDF, from its /Type /Pages /Count entry (good enough for Chromium's output). */
export function pdfPageCount(file) {
	const text = readFileSync(file).toString('latin1');
	const counts = [...text.matchAll(/\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
	if (counts.length) return Math.max(...counts);
	return (text.match(/\/Type\s*\/Page\b/g) ?? []).length;
}
