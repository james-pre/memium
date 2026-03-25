import type { Entries } from 'utilium';
import type { Options } from './attributes.js';
import * as __field from './fields.internal.js';
import type { FieldConfigInit } from './fields.js';
import { FieldBuilder } from './fields.js';
import { rawTypes, type ValidName } from './primitives.js';
import { registerType } from './types.js';

import type { ExtendStruct, FieldOf, StructConstructor, StructValue } from './structs.shared.js';

export * from './structs.shared.js';

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
			super(buffer, byteOffset, byteLength ?? buffer.byteLength - (byteOffset ?? 0));
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

	let size = base.size;

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
	Object.entries(rawTypes).map(([typeName, type]) => [typeName, new FieldBuilder<any>(type, { typeName })]) as any
) as { [K in ValidName]: FieldBuilder<(typeof rawTypes)[K]> };
