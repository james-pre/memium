/**
 * Options for struct initialization
 */
export interface Options {
	alignment?: number;
	isPacked?: boolean;
	/** Whether the struct is a union */
	isUnion?: boolean;
	isDynamic?: boolean;
	/**
	 * Skip defining fields as own enumerable properties on every instance, serving them from the prototype instead.
	 * Constructing is much cheaper, and fields are still readable and writable,
	 * but they no longer show up in `Object.keys`, spread, or `JSON.stringify`.
	 *@default false
	 */
	fastFields?: boolean;
}

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
