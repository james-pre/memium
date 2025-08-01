import type { Entries, Expand } from 'utilium';
import type { Options } from './attributes.js';
import { __fieldGet, __fieldInit, __fieldSet } from './fields.internal.js';
import type { Field, FieldConfigInit, FieldValue } from './fields.js';
import { FieldBuilder } from './fields.js';
import * as primitive from './primitives.js';
import { isType, registerType, type Type } from './types.js';

export interface StructInstance<TArrayBuffer extends ArrayBufferLike = ArrayBuffer>
	extends ArrayBufferView<TArrayBuffer> {
	constructor: StructConstructor<object>;
}

export interface StructType<T extends {}> extends Type<T & ArrayBufferView> {
	readonly fields: { [K in keyof T]: Field<Type<T[K]>> };
	readonly alignment: number;
	readonly isUnion: boolean;
}

export interface StructConstructor<T extends {}> extends StructType<T> {
	prototype: ArrayBufferView & T;

	new <TArrayBuffer extends ArrayBufferLike = ArrayBuffer>(
		buffer?: TArrayBuffer,
		byteOffset?: number,
		byteLength?: number
	): Expand<StructInstance<TArrayBuffer> & T>;
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

export function struct<const T extends Record<string, FieldConfigInit>>(
	structName: string,
	fieldDecls: T,
	...options: Options[]
) {
	const opts = options.reduce((acc, opt) => ({ ...acc, ...opt }), {});

	// Max alignment of all fields
	let fieldAlignment = 1;

	let size = 0;

	const align = (to: number) => {
		size = Math.ceil(size / to) * to;
	};

	const fields = Object.create(null) as Record<keyof T, Field>;
	for (const [name, init] of Object.entries(fieldDecls) as Entries<T>) {
		if (typeof name == 'number') throw new TypeError('Field names can not be numbers');
		const field = __fieldInit(name, init);

		if (!opts.isPacked) align(field.alignment);
		if (opts.isUnion) size = Math.max(size, field.type.size);
		else {
			field.offset = size;
			size += field.type.size;
		}

		fields[field.name as keyof T] = field;
		fieldAlignment = Math.max(fieldAlignment, field.alignment);
	}

	opts.alignment ??= fieldAlignment;

	if (!opts.isPacked) align(opts.alignment);

	class __struct<TArrayBuffer extends ArrayBufferLike = ArrayBuffer> extends DataView<TArrayBuffer> {
		static readonly name = structName;

		constructor(
			buffer: TArrayBuffer = new ArrayBuffer(size) as TArrayBuffer,
			byteOffset?: number,
			byteLength?: number
		) {
			super(buffer, byteOffset, byteLength ?? size);
			for (const field of Object.values(fields)) {
				Object.defineProperty(this, field.name, {
					enumerable: true,
					configurable: true,
					get() {
						const _ = field.type.get(this.buffer, this.byteOffset + field.offset);
						console.log(structName, field.name, '=>', _);

						return __fieldGet(this, field);
					},
					set(value) {
						__fieldSet(this, field, value);
					},
				});
			}
		}
	}

	for (const key of Object.getOwnPropertyNames(DataView.prototype)) {
		if (!key.startsWith('get') && !key.startsWith('set')) continue;
		Object.defineProperty(__struct.prototype, key, {
			enumerable: false,
			configurable: false,
			writable: false,
			value: undefined,
		});
	}

	const _struct = __struct as any as StructConstructor<{
		-readonly [K in keyof T]: FieldValue<T[K]>;
	}>;

	const fix = (value: any) => ({
		writable: false,
		enumerable: false,
		configurable: false,
		value,
	});

	Object.defineProperties(_struct, {
		size: fix(size),
		alignment: fix(opts.alignment),
		isUnion: fix(!!opts.isUnion),
		fields: fix(fields),
		get: fix((buffer: ArrayBufferLike, offset: number) => new _struct(buffer, offset)),
		set: fix((buffer: ArrayBufferLike, offset: number, value: __struct) => {
			const source = new Uint8Array(value.buffer, value.byteOffset, size);
			const target = new Uint8Array(buffer, offset, size);
			if (value.buffer === buffer && value.byteOffset === offset) return;
			for (let i = 0; i < size; i++) target[i] = source[i];
		}),
	});

	registerType(_struct);

	return _struct;
}

struct.extend = function <const T extends Record<string, FieldConfigInit<Type<unknown>>>, const Base extends {}>(
	base: StructConstructor<Base>,
	structName: string,
	fieldDecls: T,
	...options: Options[]
) {
	return struct<typeof base.fields & T>(structName, { ...base.fields, ...fieldDecls }, ...options);
};

export function union<const T extends Record<string, FieldConfigInit>>(
	unionName: string,
	fieldDecls: T,
	...options: Options[]
): StructConstructor<{ [K in keyof T]: FieldValue<T[K]> }> {
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
