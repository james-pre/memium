import { Errno, ErrnoException } from 'kerium';
import type { ArrayBufferViewConstructor } from 'utilium/buffer.js';
import { capitalize } from 'utilium/string.js';
import type { UnionToTuple } from 'utilium/types.js';

/** A definition for a primitive type */
export interface Type<T = any> {
	readonly name: string;
	readonly size: number;
	readonly array: ArrayBufferViewConstructor;
	get(this: void, view: DataView, offset: number, littleEndian: boolean): T;
	set(this: void, view: DataView, offset: number, littleEndian: boolean, value: T): void;
}

export function isType<T = any>(type: unknown): type is Type<T> {
	return (
		typeof type == 'object'
		&& type != null
		&& 'size' in type
		&& 'get' in type
		&& 'set' in type
		&& typeof type.size == 'number'
		&& typeof type.get == 'function'
		&& typeof type.set == 'function'
	);
}

export const types = {
	int8: {
		name: 'int8',
		size: 1,
		array: Int8Array,
		get: (view, offset) => view.getInt8(offset),
		set: (view, offset, _le, value) => view.setInt8(offset, value),
	},

	uint8: {
		name: 'uint8',
		size: 1,
		array: Uint8Array,
		get: (view, offset) => view.getUint8(offset),
		set: (view, offset, _le, value) => view.setUint8(offset, value),
	},

	int16: {
		name: 'int16',
		size: 2,
		array: Int16Array,
		get: (view, offset, le) => view.getInt16(offset, le),
		set: (view, offset, le, value) => view.setInt16(offset, value, le),
	},

	uint16: {
		name: 'uint16',
		size: 2,
		array: Uint16Array,
		get: (view, offset, le) => view.getUint16(offset, le),
		set: (view, offset, le, value) => view.setUint16(offset, value, le),
	},

	int32: {
		name: 'int32',
		size: 4,
		array: Int32Array,
		get: (view, offset, le) => view.getInt32(offset, le),
		set: (view, offset, le, value) => view.setInt32(offset, value, le),
	},

	uint32: {
		name: 'uint32',
		size: 4,
		array: Uint32Array,
		get: (view, offset, le) => view.getUint32(offset, le),
		set: (view, offset, le, value) => view.setUint32(offset, value, le),
	},

	int64: {
		name: 'int64',
		size: 8,
		array: BigInt64Array,
		get: (view, offset, le) => view.getBigInt64(offset, le),
		set: (view, offset, le, value) => view.setBigInt64(offset, value, le),
	},

	uint64: {
		name: 'uint64',
		size: 8,
		array: BigUint64Array,
		get: (view, offset, le) => view.getBigUint64(offset, le),
		set: (view, offset, le, value) => view.setBigUint64(offset, value, le),
	},

	float32: {
		name: 'float32',
		size: 4,
		array: Float32Array,
		get: (view, offset, le) => view.getFloat32(offset, le),
		set: (view, offset, le, value) => view.setFloat32(offset, value, le),
	},

	float64: {
		name: 'float64',
		size: 8,
		array: Float64Array,
		get: (view, offset, le) => view.getFloat64(offset, le),
		set: (view, offset, le, value) => view.setFloat64(offset, value, le),
	},
} as const satisfies Record<string, Type>;

export type TypeName = keyof typeof types;

export const typeNames = Object.keys(types) as UnionToTuple<TypeName>;

export function isTypeName(type: { toString(): string }): type is TypeName {
	return typeNames.includes(type.toString() as TypeName);
}

export type Valid = TypeName | Capitalize<TypeName> | 'char';

export const validNames = [...typeNames, ...typeNames.map(t => capitalize(t)), 'char'] satisfies Valid[];

export function isValid(type: { toString(): string }): type is Valid {
	return validNames.includes(type.toString() as Valid);
}

export function checkValid(type: { toString(): string }): asserts type is Valid {
	if (!isValid(type)) throw new ErrnoException(Errno.EINVAL, 'Not a valid primitive type: ' + type, 'isValid');
}

export type Normalize<T extends Valid> = (T extends 'char' ? 'uint8' : Uncapitalize<T>) & TypeName;

export function normalize<T extends Valid>(type: T): Normalize<T> {
	return (type == 'char' ? 'uint8' : type.toLowerCase()) as Normalize<T>;
}

export type Size<T extends Valid | Type> = (T extends Valid ? (typeof types)[Normalize<T>] : T)['size'];
