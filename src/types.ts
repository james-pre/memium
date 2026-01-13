import { ArrayType } from './array.js';
import type * as primitive from './primitives.js';

export interface ArrayOf<T, TArrayBuffer extends ArrayBufferLike = ArrayBufferLike>
	extends ArrayLike<T>,
		Iterable<T>,
		ArrayBufferView<TArrayBuffer> {
	[n: number]: T;
}

export interface TypeArrayConstructor<T = unknown> {
	new (length: number): ArrayOf<T>;
	new <TArrayBuffer extends ArrayBufferLike = ArrayBuffer>(
		buffer?: TArrayBuffer,
		byteOffset?: number,
		byteLength?: number
	): ArrayOf<T, TArrayBuffer>;
}

/** A definition for a type */
export interface Type<T = unknown> {
	readonly name: string;
	readonly size: number;
	readonly array?: TypeArrayConstructor<T>;
	readonly isDynamic?: boolean;

	/** Get a value from a buffer */
	get(this: void, buffer: ArrayBufferLike, offset: number): T;

	/** Set a value in a buffer */
	set(this: void, buffer: ArrayBufferLike, offset: number, value: T): void;
}

export function isType<T = any>(type: unknown): type is Type<T> {
	if ((typeof type != 'object' && typeof type != 'function') || type === null || type === undefined) return false;

	if (type instanceof ArrayType) return isType(type.type);

	return (
		'name' in type
		&& 'size' in type
		&& 'get' in type
		&& 'set' in type
		&& typeof type.name == 'string'
		&& typeof type.size == 'number'
		&& typeof type.get == 'function'
		&& typeof type.set == 'function'
		&& typeRegistry.has(type.name)
		&& typeRegistry.get(type.name)?.name === type.name
	);
}

export function assertType<T>(t: unknown): asserts t is Type<T> {
	if (!isType(t)) throw new TypeError(String(t) + ' is not a type');
}

const typeRegistry = new Map<string, Type<any>>();

/**
 * Resolve a type by name.
 * Useful for serialization (e.g. with JSON)
 */
export function resolveType<V>(typename: string): Type<V> | undefined {
	return typeRegistry.get(typename);
}

/**
 * Register a type.
 * Structs and unions are registered automatically.
 * You should also be able to use this as a decorator.
 */
export function registerType(t: Type) {
	if (typeRegistry.has(t.name)) throw new ReferenceError(`Type is already registered: ${t.name}`);
	typeRegistry.set(t.name, t);
}

export type TypeLike = Type | { constructor: Type } | primitive.ValidName | undefined | null;

export type Value<T extends Type> = T extends Type<infer V> ? V : never;

export const Void = {
	name: 'void',
	size: 0,
	get() {},
	set() {},
} as const satisfies Type<void>;
export type Void = typeof Void;
