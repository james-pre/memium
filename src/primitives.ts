import { withErrno } from 'kerium';
import { capitalize } from 'utilium/string.js';
import type { UnionToTuple } from 'utilium/types.js';
import type { Type } from './types.js';

const __view__ = Symbol('DataView');

function view(buffer: ArrayBufferLike & { [__view__]?: DataView }): DataView {
	buffer[__view__] ??= new DataView(buffer);
	return buffer[__view__];
}

export const types = {
	int8: {
		name: 'int8',
		size: 1,
		array: Int8Array,
		get: (buffer, offset) => view(buffer).getInt8(offset),
		set: (buffer, offset, value) => view(buffer).setInt8(offset, value),
	},

	uint8: {
		name: 'uint8',
		size: 1,
		array: Uint8Array,
		get: (buffer, offset) => view(buffer).getUint8(offset),
		set: (buffer, offset, value) => view(buffer).setUint8(offset, value),
	},

	int16: {
		name: 'int16',
		size: 2,
		array: Int16Array,
		get: (buffer, offset) => view(buffer).getInt16(offset, true),
		set: (buffer, offset, value) => view(buffer).setInt16(offset, value, true),
	},

	uint16: {
		name: 'uint16',
		size: 2,
		array: Uint16Array,
		get: (buffer, offset) => view(buffer).getUint16(offset, true),
		set: (buffer, offset, value) => view(buffer).setUint16(offset, value, true),
	},

	int32: {
		name: 'int32',
		size: 4,
		array: Int32Array,
		get: (buffer, offset) => view(buffer).getInt32(offset, true),
		set: (buffer, offset, value) => view(buffer).setInt32(offset, value, true),
	},

	uint32: {
		name: 'uint32',
		size: 4,
		array: Uint32Array,
		get: (buffer, offset) => view(buffer).getUint32(offset, true),
		set: (buffer, offset, value) => view(buffer).setUint32(offset, value, true),
	},

	int64: {
		name: 'int64',
		size: 8,
		array: BigInt64Array,
		get: (buffer, offset) => view(buffer).getBigInt64(offset, true),
		set: (buffer, offset, value) => view(buffer).setBigInt64(offset, value, true),
	},

	uint64: {
		name: 'uint64',
		size: 8,
		array: BigUint64Array,
		get: (buffer, offset) => view(buffer).getBigUint64(offset, true),
		set: (buffer, offset, value) => view(buffer).setBigUint64(offset, value, true),
	},

	float32: {
		name: 'float32',
		size: 4,
		array: Float32Array,
		get: (buffer, offset) => view(buffer).getFloat32(offset, true),
		set: (buffer, offset, value) => view(buffer).setFloat32(offset, value, true),
	},

	float64: {
		name: 'float64',
		size: 8,
		array: Float64Array,
		get: (buffer, offset) => view(buffer).getFloat64(offset, true),
		set: (buffer, offset, value) => view(buffer).setFloat64(offset, value, true),
	},
} as const satisfies Record<string, Type>;

export type TypeName = keyof typeof types;

export const typeNames = Object.keys(types) as UnionToTuple<TypeName>;

export function isTypeName(type: { toString(): string }): type is TypeName {
	return typeNames.includes(type.toString() as TypeName);
}

export type ValidName = TypeName | Capitalize<TypeName> | 'char';

export const validNames = [...typeNames, ...typeNames.map(t => capitalize(t)), 'char'] satisfies ValidName[];

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
