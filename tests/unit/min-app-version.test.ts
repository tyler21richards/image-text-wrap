// Every Obsidian API the plugin uses must exist in the oldest Obsidian manifest.json allows. The typings
// mark each API with the version that added it (@since); this reads every name in src/ through the
// TypeScript checker. Unlike the obsidianmd lint rule, it also resolves property names written in object
// literals, which is how settings are declared ({ type: 'slider', displayFormat }, @since 1.13.1).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

function compare(a: string, b: string): number {
	const x = a.split('.').map(Number);
	const y = b.split('.').map(Number);
	for (let i = 0; i < 3; i++) if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
	return 0;
}

interface ApiUse {
	/** "file:line Name". */
	where: string;
	since: string;
}

/** Every use of an Obsidian API in src/ whose typings say when it was added. */
function apiUses(): ApiUse[] {
	const configPath = join(ROOT, 'tsconfig.json');
	const config = ts.parseJsonConfigFileContent(ts.readConfigFile(configPath, ts.sys.readFile).config, ts.sys, ROOT);
	const program = ts.createProgram(config.fileNames, config.options);
	const checker = program.getTypeChecker();
	const uses: ApiUse[] = [];

	const report = (node: ts.Node, found: ts.Symbol | undefined) => {
		if (!found) return;
		const symbol = found.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(found) : found;
		for (const decl of symbol.getDeclarations() ?? []) {
			if (!decl.getSourceFile().fileName.replace(/\\/g, '/').endsWith('/obsidian/obsidian.d.ts')) continue;
			const since = ts.getJSDocTags(decl).find((t) => t.tagName.text === 'since')?.comment;
			if (typeof since !== 'string') continue;
			const file = node.getSourceFile();
			const line = file.getLineAndCharacterOfPosition(node.getStart()).line + 1;
			uses.push({ where: `${relative(ROOT, file.fileName)}:${line} ${symbol.getName()}`, since: since.trim() });
		}
	};

	const visit = (node: ts.Node): void => {
		if (ts.isIdentifier(node)) {
			report(node, checker.getSymbolAtLocation(node));
			// A property written in an object literal: look it up on the type the literal must have, narrowed
			// by its own `type: '…'` when that type is a union (settings controls are).
			const prop = node.parent;
			if (prop && ts.isPropertyAssignment(prop) && prop.name === node && ts.isObjectLiteralExpression(prop.parent)) {
				const literal = prop.parent;
				const contextual = checker.getContextualType(literal);
				if (contextual) {
					let types = contextual.isUnion() ? contextual.types : [contextual];
					const tag = literal.properties.find(
						(p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && p.name.getText() === 'type' && ts.isStringLiteral(p.initializer),
					);
					if (tag && types.length > 1) {
						const want = (tag.initializer as ts.StringLiteral).text;
						types = types.filter((t) => {
							const typeProp = checker.getPropertyOfType(t, 'type');
							if (!typeProp) return false;
							const tt = checker.getTypeOfSymbol(typeProp);
							return (tt.isUnion() ? tt.types : [tt]).some((x) => x.isStringLiteral() && x.value === want);
						});
					}
					for (const t of types) report(node, checker.getPropertyOfType(t, node.text));
				}
			}
		}
		ts.forEachChild(node, visit);
	};

	for (const file of program.getSourceFiles()) {
		if (relative(ROOT, file.fileName).startsWith('src')) visit(file);
	}
	return uses;
}

const uses = apiUses();

/** The uses of APIs added after Obsidian `min`, as "file:line Name @since x.y.z". */
function newerThan(min: string): string[] {
	return [...new Set(uses.filter((u) => compare(u.since, min) > 0).map((u) => `${u.where} @since ${u.since}`))];
}

test('every Obsidian API used exists in the minAppVersion of manifest.json and versions.json', () => {
	const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8')) as { version: string; minAppVersion: string };
	const versions = JSON.parse(readFileSync(join(ROOT, 'versions.json'), 'utf8')) as Record<string, string>;
	assert.equal(versions[manifest.version], manifest.minAppVersion);
	assert.ok(uses.length > 100, `only ${uses.length} Obsidian API uses found: the check is not reading src/`);
	assert.deepEqual(newerThan(manifest.minAppVersion), []);
});

test('the check sees settings properties written in object literals', () => {
	// displayFormat (src/settings.ts) was added in Obsidian 1.13.1, so it must show up against 1.13.0.
	assert.ok(newerThan('1.13.0').some((use) => use.startsWith('src/settings.ts:') && use.endsWith('displayFormat @since 1.13.1')));
});
