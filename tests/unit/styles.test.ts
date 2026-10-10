import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// styles.css is shipped as written. Chromium accepts CSS nesting, so a missing "}" silently turns every
// later rule into a nested rule that never matches (this happened once after a merge).
const css = readFileSync(new URL('../../styles.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

test('styles.css has balanced braces and no rule nested inside another', () => {
	// The prelude (selector or at-rule) of every open block, innermost last.
	const open: string[] = [];
	let prelude = '';
	for (const ch of css) {
		if (ch === '{') {
			const parent = open[open.length - 1];
			assert.ok(parent === undefined || parent.startsWith('@media'), `rule nested in a rule: ${prelude.trim().slice(0, 80)}`);
			open.push(prelude.trim());
			prelude = '';
		} else if (ch === '}') {
			assert.ok(open.pop() !== undefined, 'a "}" closes nothing');
			prelude = '';
		} else if (ch === ';') prelude = '';
		else prelude += ch;
	}
	assert.equal(open.length, 0, `unclosed "{" after ${open[open.length - 1]?.slice(0, 80)}`);
});

test('styles.css avoids :has() and keeps !important to the one documented case', () => {
	assert.ok(!css.includes(':has('));
	const important = css.match(/!important/g) ?? [];
	assert.equal(important.length, 1);
});
