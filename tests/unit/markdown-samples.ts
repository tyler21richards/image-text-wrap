// Shared by the randomised tests of the line scanner and the Live Preview line classes.

/** A small seeded random generator, so a failure repeats. */
export function random(seed: number): () => number {
	return () => {
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export const pick = <T>(next: () => number, xs: readonly T[]): T => xs[Math.floor(next() * xs.length)]!;

/** Lines of every kind the scanner knows, plain or not, with and without wrapped images. */
export const LINE_POOL: readonly string[] = [
	'',
	'   ',
	'---',
	'...',
	'```',
	'```js',
	'~~~',
	'$$',
	'$$x$$',
	'%%',
	'%% hidden %%',
	'<!--',
	'-->',
	'| a | b |',
	'| --- | --- |',
	'---|---',
	':-:',
	'# Heading',
	'## Heading',
	'> quote',
	'> [!note] Callout',
	'- item',
	'* item',
	'1. item',
	'10. item',
	'-',
	'   - item',
	'> # Heading',
	'[^1]: note',
	'[^1]: ![[a.png|wrap-left|60]]',
	'  indented',
	'\tindented',
	'    ![[a.png|wrap-left|60]]',
	' ![[a.png|wrap-left|60]]',
	'  ![[a.png|wrap-right|60]]',
	'![[a.png|wrap-left|60]] ![[b.png|wrap-right|60]]',
	'Text ![wrap-left|60](https://example.com/a.png) more',
	'![wrap-right|gap-8](data:image/png;base64,AAAA)',
	'***',
	'===',
	'--',
	'Text.',
	'More text, with a comma.',
	'x',
	'![[a.png|wrap-left|60]]',
	'![[a.png|wrap-right|gap-8|60]]',
	'![wrap-right](x.png)',
	'![wrap-block|60](x.png)',
	'![a [b] c|wrap-right](x.png)',
	'`![[a.png|wrap-left]]`',
	'Text ![[b.png]] and more',
	'text with a | pipe',
	'...more',
	'Dollar $5 and 5%',
];
