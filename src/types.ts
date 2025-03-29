import type { ArrayBufferViewConstructor } from 'utilium/buffer.js';
import type * as struct from './internal.js';
import type * as primitive from './primitives.js';

/** A definition for a type */
export interface Type<T = any> {
	readonly name: string;
	readonly size: number;
	readonly array?: ArrayBufferViewConstructor;

	/** Get a value from a buffer */
	get(this: void, buffer: ArrayBufferLike, offset: number): T;

	/** Set a value in a buffer */
	set(this: void, buffer: ArrayBufferLike, offset: number, value: T): void;
}

export function isType<T = any>(type: unknown): type is Type<T> {
	return (
		(typeof type == 'object' || typeof type == 'function')
		&& type != null
		&& 'size' in type
		&& 'get' in type
		&& 'set' in type
		&& typeof type.size == 'number'
		&& typeof type.get == 'function'
		&& typeof type.set == 'function'
	);
}

export type TypeLike = Type | struct.Like | primitive.ValidName | undefined | null;

export type Value<T extends Type> = T extends Type<infer V> ? V : never;
