import type { Options } from './internal.js';

/**
 * A shortcut for packing structs.
 */
export const packed = { isPacked: true } satisfies Options;

/**
 * A shortcut for setting alignment
 */
export function align(n: number): Options {
	return { alignment: n };
}
