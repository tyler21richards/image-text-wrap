// Command-line front end for tests/e2e/obsidian.mjs.
//
//   node scripts/obsidian.mjs launch [--fresh]     start Obsidian (instance from ITW_INSTANCE)
//   node scripts/obsidian.mjs reload               copy the build into the vault and reload the plugin
//   node scripts/obsidian.mjs open <path> [live|source|reading]
//   node scripts/obsidian.mjs eval '<js expression or async body>'   runs in the Obsidian window, prints JSON
//   node scripts/obsidian.mjs run <file.mjs>       runs a script exporting default async ({page, ...harness})
//   node scripts/obsidian.mjs shot <out.png>       screenshot of the window
//   node scripts/obsidian.mjs sync                 copy test-vault notes into the instance vault
//   node scripts/obsidian.mjs quit
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import * as h from '../tests/e2e/obsidian.mjs';

const [cmd, ...rest] = process.argv.slice(2);
const cfg = h.config();

async function withPage(fn) {
	const { browser, page } = await h.connect(cfg);
	try {
		return await fn(page);
	} finally {
		// Closing a CDP-connected browser only detaches; Obsidian keeps running.
		await browser.close().catch(() => {});
	}
}

switch (cmd) {
	case 'launch':
		await h.launch(cfg, { fresh: rest.includes('--fresh') });
		await withPage((page) => h.reloadPlugin(page, cfg));
		console.log(`Obsidian instance ${cfg.instance} on port ${cfg.port}, vault ${cfg.vault}`);
		break;
	case 'reload':
		await withPage((page) => h.reloadPlugin(page, cfg));
		console.log('plugin reloaded');
		break;
	case 'sync':
		h.syncVault(cfg);
		console.log('vault synced');
		break;
	case 'open':
		await withPage((page) => h.openNote(page, rest[0], rest[1] ?? 'live'));
		break;
	case 'eval': {
		const src = rest.join(' ');
		const out = await withPage((page) =>
			page.evaluate(async (src) => {
				const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
				const body = /\breturn\b/.test(src) ? src : `return (${src});`;
				return await new AsyncFunction(body)();
			}, src),
		);
		console.log(JSON.stringify(out, null, 2));
		break;
	}
	case 'run': {
		const mod = await import(pathToFileURL(resolve(rest[0])).href);
		const out = await withPage((page) => mod.default({ page, cfg, ...h, args: rest.slice(1) }));
		if (out !== undefined) console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 2));
		break;
	}
	case 'shot':
		await withPage((page) => page.screenshot({ path: rest[0] ?? 'shot.png' }));
		console.log('saved', rest[0] ?? 'shot.png');
		break;
	case 'quit':
		await h.quit(cfg);
		console.log('quit');
		break;
	default:
		console.error('unknown command; see the header of scripts/obsidian.mjs');
		process.exit(1);
}
