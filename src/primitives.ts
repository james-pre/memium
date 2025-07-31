/* eslint-disable @typescript-eslint/no-empty-object-type */
import { withErrno } from 'kerium';
import { capitalize } from 'utilium/string.js';
import type { UnionToTuple } from 'utilium/types.js';
import type { Type } from './types.js';
import { registerType } from './types.js';

const __view__ = Symbol('DataView');

/**
 * @internal @hidden
 */
function view(buffer: ArrayBufferLike & { [__view__]?: DataView }): DataView {
	buffer[__view__] ??= new DataView(buffer);
	return buffer[__view__];
}

export { view as __view };

/**
 * So we don't need to create intermediate types for each interface
 */
type _<x> = x;

const int8 = {
	name: 'int8',
	size: 1,
	array: Int8Array,
	get: (buffer, offset) => view(buffer).getInt8(offset),
	set: (buffer, offset, value) => view(buffer).setInt8(offset, value),
} as const satisfies Type<number>;
interface int8 extends _<typeof int8> {}

const uint8 = {
	name: 'uint8',
	size: 1,
	array: Uint8Array,
	get: (buffer, offset) => view(buffer).getUint8(offset),
	set: (buffer, offset, value) => view(buffer).setUint8(offset, value),
} as const satisfies Type<number>;
interface uint8 extends _<typeof uint8> {}

const int16 = {
	name: 'int16',
	size: 2,
	array: Int16Array,
	get: (buffer, offset) => view(buffer).getInt16(offset, true),
	set: (buffer, offset, value) => view(buffer).setInt16(offset, value, true),
} as const satisfies Type<number>;
interface int16 extends _<typeof int16> {}

const uint16 = {
	name: 'uint16',
	size: 2,
	array: Uint16Array,
	get: (buffer, offset) => view(buffer).getUint16(offset, true),
	set: (buffer, offset, value) => view(buffer).setUint16(offset, value, true),
} as const satisfies Type<number>;
interface uint16 extends _<typeof uint16> {}

const int32 = {
	name: 'int32',
	size: 4,
	array: Int32Array,
	get: (buffer, offset) => view(buffer).getInt32(offset, true),
	set: (buffer, offset, value) => view(buffer).setInt32(offset, value, true),
} as const satisfies Type<number>;
interface int32 extends _<typeof int32> {}

const uint32 = {
	name: 'uint32',
	size: 4,
	array: Uint32Array,
	get: (buffer, offset) => view(buffer).getUint32(offset, true),
	set: (buffer, offset, value) => view(buffer).setUint32(offset, value, true),
} as const satisfies Type<number>;
interface uint32 extends _<typeof uint32> {}

const int64 = {
	name: 'int64',
	size: 8,
	array: BigInt64Array,
	get: (buffer, offset) => view(buffer).getBigInt64(offset, true),
	set: (buffer, offset, value) => view(buffer).setBigInt64(offset, value, true),
} as const satisfies Type<bigint>;
interface int64 extends _<typeof int64> {}

const uint64 = {
	name: 'uint64',
	size: 8,
	array: BigUint64Array,
	get: (buffer, offset) => view(buffer).getBigUint64(offset, true),
	set: (buffer, offset, value) => view(buffer).setBigUint64(offset, value, true),
} as const satisfies Type<bigint>;
interface uint64 extends _<typeof uint64> {}

const float32 = {
	name: 'float32',
	size: 4,
	array: Float32Array,
	get: (buffer, offset) => view(buffer).getFloat32(offset, true),
	set: (buffer, offset, value) => view(buffer).setFloat32(offset, value, true),
} as const satisfies Type<number>;
interface float32 extends _<typeof float32> {}

const float64 = {
	name: 'float64',
	size: 8,
	array: Float64Array,
	get: (buffer, offset) => view(buffer).getFloat64(offset, true),
	set: (buffer, offset, value) => view(buffer).setFloat64(offset, value, true),
} as const satisfies Type<number>;
interface float64 extends _<typeof float64> {}

export const types = {
	int8: int8 as int8,
	uint8: uint8 as uint8,
	int16: int16 as int16,
	uint16: uint16 as uint16,
	int32: int32 as int32,
	uint32: uint32 as uint32,
	int64: int64 as int64,
	uint64: uint64 as uint64,
	float32: float32 as float32,
	float64: float64 as float64,
} as const satisfies Record<string, Type>;

export type TypeName = keyof typeof types;

export type AnyType = (typeof rawTypes)[ValidName];

export const typeNames = Object.keys(types) as UnionToTuple<TypeName>;

for (const t of Object.values(types)) registerType(t);

export function isTypeName(type: { toString(): string }): type is TypeName {
	return typeNames.includes(type.toString() as TypeName);
}

export const rawTypes = {
	...types,
	...(Object.fromEntries(typeNames.map(t => [capitalize(t), types[t]])) as {
		[K in TypeName as Capitalize<K>]: (typeof types)[K];
	}),
	char: uint8 as uint8,
} as const satisfies Record<string, Type>;

export type ValidName = keyof typeof rawTypes;

export const validNames = Object.keys(rawTypes) as UnionToTuple<ValidName>;

export function isValid(type: { toString(): string }): type is ValidName {
	return validNames.includes(type.toString() as ValidName);
}

export function checkValid(type: { toString(): string }): asserts type is ValidName {
	if (!isValid(type)) throw withErrno('EINVAL', 'Not a valid primitive type: ' + type);
}

export type Normalize<T extends ValidName> = (T extends 'char' ? 'uint8' : Uncapitalize<T>) & TypeName;

export function normalize<T extends ValidName>(type: T): Normalize<T> {
	return (type == 'char' ? 'uint8' : type.toLowerCase()) as Normalize<T>;
}

export type Size<T extends ValidName | Type> = (T extends ValidName ? (typeof types)[Normalize<T>] : T)['size'];
