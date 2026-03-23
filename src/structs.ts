import type { Entries, Expand } from 'utilium';
import type { Options } from './attributes.js';
import * as __field from './fields.internal.js';
import type { Field, FieldConfigInit, FieldValue } from './fields.js';
import { FieldBuilder } from './fields.js';
import * as primitive from './primitives.js';
import { isType, registerType, type Type } from './types.js';

export type StructInstance<
	T extends {},
	TArrayBuffer extends ArrayBufferLike = ArrayBuffer,
> = ArrayBufferView<TArrayBuffer> & {
	constructor: StructConstructor<T>;
} & T;

export function isStructInstance<T extends {}>(arg: unknown): arg is StructInstance<T> {
	return (
		typeof arg == 'object' && arg !== null && 'constructor' in arg && isStructConstructor((arg as any).constructor)
	);
}

export interface StructType<T extends {}> extends Type<T & ArrayBufferView> {
	/** @hidden breaks typedoc in dependencies */
	readonly fields: FieldOf<T>[];
	readonly alignment: number;
	readonly isUnion: boolean;
	readonly isDynamic?: boolean;
}

export interface StructConstructor<T extends {}> extends StructType<T> {
	prototype: StructInstance<T>;

	new <TArrayBuffer extends ArrayBufferLike = any>(
		buffer?: TArrayBuffer,
		byteOffset?: number,
		byteLength?: number
	): Expand<StructInstance<T, TArrayBuffer>>;
}

export type InstanceOf<T extends StructConstructor<any>> =
	T extends StructConstructor<infer U> ? U & InstanceType<T> & { constructor: T } : never;

export interface FieldOf<T extends {}> extends Field<Type<T[keyof T]>> {
	name: keyof T & string;
	countedBy?: (keyof T & string) | ((instance: StructInstance<T>) => number);
}

export function isStructConstructor(arg: unknown): arg is StructConstructor<any> {
	return (
		typeof arg == 'function'
		&& 'prototype' in arg
		&& 'fields' in arg
		&& typeof arg.fields == 'object'
		&& isType(arg)
	);
}

export type StructValue<T extends Record<string, FieldConfigInit>> = Expand<{
	-readonly [K in keyof T]: FieldValue<T[K]>;
}>;

export type ExtendStruct<Base extends StructConstructor<any>, T extends Record<string, FieldConfigInit>> =
	Base extends StructConstructor<infer U>
		? Expand<{
				-readonly [K in keyof T | keyof U]: K extends keyof T
					? FieldValue<T[K]>
					: K extends keyof U
						? U[K]
						: never;
			}>
		: never;

export function struct<const T extends Record<string, FieldConfigInit>>(
	this: Function | Options | void,
	structName: string,
	fieldDecls: T,
	...options: Options[]
): StructConstructor<StructValue<T>> {
	const opts = options.reduce((acc, opt) => ({ ...acc, ...opt }), {});
	if (typeof this == 'object') Object.assign(opts, this);

	// Max alignment of all fields
	let fieldAlignment = 1;

	let size = 0;

	const align = (to: number) => {
		size = Math.ceil(size / to) * to;
	};

	const fields: FieldOf<StructValue<T>>[] = [];
	for (const [name, init] of Object.entries(fieldDecls) as Entries<T>) {
		if (typeof name == 'number') throw new TypeError('Field names can not be numbers');
		const field = __field.init(name as keyof T & string, init);

		if (!opts.isPacked) align(field.alignment);
		if (opts.isUnion) size = Math.max(size, field.type.size);
		else {
			field.offset = size;
			size += field.type.size;
		}

		fields.push(field as FieldOf<StructValue<T>>);
		fieldAlignment = Math.max(fieldAlignment, field.alignment);
	}

	opts.alignment ??= fieldAlignment;

	if (!opts.isPacked) align(opts.alignment);

	class _struct<TArrayBuffer extends ArrayBufferLike = ArrayBuffer> extends DataView<TArrayBuffer> {
		static readonly name = structName;
		static readonly size = size;
		static readonly alignment = opts.alignment!;
		static readonly isUnion = !!opts.isUnion;
		static readonly isDynamic = !!opts.isDynamic;
		static readonly fields = fields;
		static get(buffer: ArrayBufferLike, offset: number) {
			return new this(buffer, offset);
		}
		static set(buffer: ArrayBufferLike, offset: number, value: _struct) {
			const source = new Uint8Array(value.buffer, value.byteOffset, this.size);
			const target = new Uint8Array(buffer, offset, this.size);
			if (value.buffer === buffer && value.byteOffset === offset) return;
			for (let i = 0; i < this.size; i++) target[i] = source[i];
		}
		static readonly [Symbol.toStringTag] = `[struct ${structName}]`;

		constructor(
			buffer: TArrayBuffer = new ArrayBuffer(size) as TArrayBuffer,
			byteOffset?: number,
			byteLength?: number
		) {
			super(buffer, byteOffset, byteLength ?? size);
			for (const field of Object.values((this.constructor as typeof _struct).fields ?? fields)) {
				Object.defineProperty(this, field.name, {
					enumerable: true,
					configurable: true,
					get() {
						return __field.get(this, field);
					},
					set(value) {
						__field.set(this, field, value);
					},
				});
			}
		}
	}

	for (const key of Object.getOwnPropertyNames(DataView.prototype)) {
		if (!key.startsWith('get') && !key.startsWith('set')) continue;
		Object.defineProperty(_struct.prototype, key, {
			enumerable: false,
			configurable: false,
			writable: false,
			value: undefined,
		});
	}

	registerType(_struct);

	return _struct as any as StructConstructor<StructValue<T>>;
}

struct.extend = function <const T extends Record<string, FieldConfigInit>, const Base extends StructConstructor<any>>(
	base: Base & (new (...args: any[]) => any),
	structName: string,
	fieldDecls: T,
	...options: Options[]
): StructConstructor<ExtendStruct<Base, T>> {
	const opts = options.reduce((acc, opt) => ({ ...acc, ...opt }), {});
	if (typeof this == 'object') Object.assign(opts, this);

	// Max alignment of all fields
	let fieldAlignment = 1;

	let size = 0;

	const align = (to: number) => {
		size = Math.ceil(size / to) * to;
	};

	const fields: FieldOf<ExtendStruct<Base, T>>[] = base.fields;
	for (const [name, init] of Object.entries(fieldDecls) as Entries<T>) {
		if (typeof name == 'number') throw new TypeError('Field names can not be numbers');
		const field = __field.init(name as keyof T & string, init);

		if (!opts.isPacked) align(field.alignment);
		if (opts.isUnion) size = Math.max(size, field.type.size);
		else {
			field.offset = size;
			size += field.type.size;
		}

		fields.push(field as FieldOf<ExtendStruct<Base, T>>);
		fieldAlignment = Math.max(fieldAlignment, field.alignment);
	}

	opts.alignment ??= fieldAlignment;

	if (!opts.isPacked) align(opts.alignment);

	class _struct extends base {
		static readonly name = structName;
		static readonly size = size;
		static readonly alignment = opts.alignment!;
		static readonly isUnion = !!opts.isUnion;
		static readonly isDynamic = !!opts.isDynamic;
		static readonly fields = fields;
		static readonly [Symbol.toStringTag] = `[struct ${structName}]`;
	}

	registerType(_struct);

	return _struct as any as StructConstructor<ExtendStruct<Base, T>>;
};

struct.packed = struct.bind({ isPacked: true }) as typeof struct;
struct.align = function (alignment: number) {
	return struct.bind({ alignment }) as typeof struct;
};
struct.dynamic = struct.bind({ isDynamic: true }) as typeof struct;

export function union<const T extends Record<string, FieldConfigInit>>(
	unionName: string,
	fieldDecls: T,
	...options: Options[]
): StructConstructor<StructValue<T>> {
	return struct(unionName, fieldDecls, ...options, { isUnion: true });
}

/**
 * Shortcuts for primitive types that allow easily making arrays
 */
export const types = Object.fromEntries(
	Object.entries(primitive.rawTypes).map(([typeName, type]) => [
		typeName,
		new FieldBuilder<any>(type, { typeName }),
	]) as any
) as { [K in primitive.ValidName]: FieldBuilder<(typeof primitive.rawTypes)[K]> };

/**
 * Gets the dynamic size in bytes of a struct instance.
 * This *does not* include the static size of the struct.
 */
export function dynamicStructSize<T extends {}>(instance: StructInstance<T>): number {
	let size = 0;

	for (const field of instance.constructor.fields) {
		const value = instance[field.name];
		if (__field.isDynamicArray(instance, field)) {
			size += __field.dynamicArraySize(instance, field);
		}

		if (isStructInstance(value) && value.constructor.isDynamic) {
			size += dynamicStructSize(value);
		}
	}

	return size;
}
