// Drives a real Obsidian over the Chrome DevTools Protocol.
// Mouse and keyboard go through Input.dispatch*Event (via playwright-core), so the page sees trusted events.
//
// Environment:
//   OBSIDIAN_APP     path to Obsidian.app (required unless the default below exists)
//   ITW_STATE_DIR    where profiles and vault copies live (default: ./.e2e)
//   ITW_INSTANCE     instance number, 0 by default. Each instance has its own port, profile and vault copy,
//                    so several can run side by side.
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const PLUGIN_ID = 'image-text-wrap';

export function config() {
	const instance = Number(process.env.ITW_INSTANCE ?? 0);
	const stateDir = resolve(process.env.ITW_STATE_DIR ?? join(ROOT, '.e2e'));
	const app = process.env.OBSIDIAN_APP ?? '/Applications/Obsidian.app';
	return {
		instance,
		port: 9333 + instance,
		app,
		binary: join(app, 'Contents/MacOS/Obsidian'),
		profile: join(stateDir, `profile-${instance}`),
		vault: join(stateDir, `vault-${instance}`),
		sourceVault: join(ROOT, 'test-vault'),
	};
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpUp(port) {
	try {
		const res = await fetch(`http://127.0.0.1:${port}/json/version`);
		return res.ok;
	} catch {
		return false;
	}
}

/** Copies the notes and images of test-vault into this instance's vault, keeping its .obsidian folder. */
export function syncVault(cfg = config()) {
	mkdirSync(cfg.vault, { recursive: true });
	cpSync(cfg.sourceVault, cfg.vault, {
		recursive: true,
		filter: (src) => !src.includes(`${join(cfg.sourceVault, '.obsidian')}`),
	});
}

/** Copies the built plugin into this instance's vault. */
export function installPlugin(cfg = config()) {
	const dir = join(cfg.vault, '.obsidian/plugins', PLUGIN_ID);
	mkdirSync(dir, { recursive: true });
	for (const f of ['main.js', 'manifest.json', 'styles.css']) {
		if (existsSync(join(ROOT, f))) cpSync(join(ROOT, f), join(dir, f));
	}
}

function writeProfile(cfg) {
	mkdirSync(cfg.profile, { recursive: true });
	const file = join(cfg.profile, 'obsidian.json');
	let data = {};
	if (existsSync(file)) data = JSON.parse(readFileSync(file, 'utf8'));
	const id = (data.vaults && Object.keys(data.vaults)[0]) ?? `itw${String(cfg.instance).padStart(13, '0')}`;
	data.vaults = { [id]: { path: cfg.vault, ts: 1760000000000, open: true } };
	data.updateDisabled = true;
	writeFileSync(file, JSON.stringify(data));
	const obs = join(cfg.vault, '.obsidian');
	mkdirSync(obs, { recursive: true });
	const cp = join(obs, 'community-plugins.json');
	if (!existsSync(cp)) writeFileSync(cp, JSON.stringify([PLUGIN_ID]));
	const appJson = join(obs, 'app.json');
	if (!existsSync(appJson)) writeFileSync(appJson, JSON.stringify({ readableLineLength: true, livePreview: true }));
}

/** Starts Obsidian for this instance if it is not already listening, and waits for the vault window. */
export async function launch(cfg = config(), { fresh = false } = {}) {
	if (await cdpUp(cfg.port)) return;
	if (fresh) rmSync(cfg.profile, { recursive: true, force: true });
	syncVault(cfg);
	installPlugin(cfg);
	writeProfile(cfg);
	const child = spawn(cfg.binary, [`--remote-debugging-port=${cfg.port}`, `--user-data-dir=${cfg.profile}`], {
		detached: true,
		stdio: 'ignore',
	});
	child.unref();
	for (let i = 0; i < 100 && !(await cdpUp(cfg.port)); i++) await sleep(200);
	if (!(await cdpUp(cfg.port))) throw new Error(`Obsidian did not open DevTools port ${cfg.port}`);
}

/**
 * Keeps measurements valid while the window is in the background: a hidden or occluded window
 * stops requestAnimationFrame (so CodeMirror stops measuring), and an unfocused one loses focus events.
 */
async function prepareWindow(page) {
	await page.evaluate(() => window.electronWindow?.setBackgroundThrottling(false)).catch(() => {});
	try {
		const session = await page.context().newCDPSession(page);
		await session.send('Emulation.setFocusEmulationEnabled', { enabled: true });
		// Keep the session open for the life of this connection, or the emulation ends with it.
		page.__itwSession = session;
	} catch {
		/* older Chromium: ignore */
	}
}

/** Connects and returns { browser, page } for the vault window (not the starter window). */
export async function connect(cfg = config()) {
	const browser = await chromium.connectOverCDP(`http://127.0.0.1:${cfg.port}`);
	for (let i = 0; i < 100; i++) {
		for (const ctx of browser.contexts()) {
			for (const page of ctx.pages()) {
				const ok = await page
					.evaluate(() => typeof window.app !== 'undefined' && !!window.app.workspace?.layoutReady)
					.catch(() => false);
				if (ok) {
					await prepareWindow(page);
					return { browser, page };
				}
			}
		}
		await sleep(200);
	}
	throw new Error('No Obsidian vault window found');
}

/** Sets the inner (content) size of the Obsidian window. Electron has no CDP Browser domain, so use its BrowserWindow. */
export async function setWindowSize(page, width, height) {
	await page.evaluate(
		({ width, height }) => {
			const w = window.electronWindow;
			if (w.isMaximized()) w.unmaximize();
			w.setContentSize(width, height);
			w.setBackgroundThrottling(false);
		},
		{ width, height },
	);
	await sleep(400);
}

/** Turns off restricted mode in this test vault and (re)loads the plugin from disk. */
export async function reloadPlugin(page, cfg = config()) {
	installPlugin(cfg);
	// First open of the vault asks whether to trust its plugins. This is our own test vault.
	await page.evaluate(() => {
		for (const b of document.querySelectorAll('.modal-container button')) {
			if (b.textContent?.trim() === 'Trust author and enable plugins') b.click();
		}
	});
	await page.evaluate(async (id) => {
		const plugins = window.app.plugins;
		if (!plugins.isEnabled()) await plugins.setEnable(true);
		if (plugins.plugins[id]) await plugins.disablePlugin(id);
		await plugins.loadManifests();
		await plugins.enablePluginAndSave(id);
	}, PLUGIN_ID);
	await sleep(300);
}

/** Opens a note in Live Preview ("live"), Source ("source") or Reading view ("reading") in the active leaf. */
export async function openNote(page, path, mode = 'live') {
	await page.evaluate(
		async ({ path, mode }) => {
			const file = window.app.vault.getAbstractFileByPath(path);
			if (!file) throw new Error(`No file ${path}`);
			const leaf = window.app.workspace.getLeaf(false);
			const state =
				mode === 'reading' ? { mode: 'preview' } : { mode: 'source', source: mode === 'source' };
			await leaf.openFile(file, { state, active: true });
		},
		{ path, mode },
	);
	await sleep(500);
}

/** Overwrites a note's text through the vault, so open editors pick it up. */
export async function setNote(page, path, text) {
	await page.evaluate(
		async ({ path, text }) => {
			const file = window.app.vault.getAbstractFileByPath(path);
			if (file) await window.app.vault.modify(file, text);
			else await window.app.vault.create(path, text);
		},
		{ path, text },
	);
	await sleep(300);
}

export async function getNote(page, path) {
	return page.evaluate(async (path) => {
		const file = window.app.vault.getAbstractFileByPath(path);
		return window.app.vault.read(file);
	}, path);
}

/** Collects console errors and uncaught exceptions from the page from now on. */
export function watchErrors(page) {
	const errors = [];
	page.on('console', (m) => {
		if (m.type() === 'error') errors.push(m.text());
	});
	page.on('pageerror', (e) => errors.push(String(e)));
	return errors;
}

export async function quit(cfg = config()) {
	if (!(await cdpUp(cfg.port))) return;
	try {
		const { browser, page } = await connect(cfg);
		await page.evaluate(() => window.require('electron').ipcRenderer.send('quit')).catch(() => {});
		await browser.close().catch(() => {});
	} catch {
		/* fall through to pkill */
	}
	await sleep(1000);
	if (await cdpUp(cfg.port)) {
		spawn('pkill', ['-f', `remote-debugging-port=${cfg.port}`]);
		await sleep(500);
	}
}
