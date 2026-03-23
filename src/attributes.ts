/**
 * Options for struct initialization
 */
export interface Options {
	alignment?: number;
	isPacked?: boolean;
	/** Whether the struct is a union */
	isUnion?: boolean;
	isDynamic?: boolean;
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
