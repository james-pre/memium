import { withErrno } from 'kerium';
import type { Entries, Expand } from 'utilium';
import { FieldBuilder, parseFieldConfig, type FieldConfigInit, type FieldValue } from './fields.js';
import { getField, setField, type Field, type Options } from './internal.js';
import * as primitive from './primitives.js';
import { isType, registerType, type Type } from './types.js';

export interface StructConstructor<T extends {}> extends Type<T & ArrayBufferView> {
	prototype: ArrayBufferView & T;
	readonly fields: { [K in keyof T]: Field<Type<T[K]>> };
	readonly alignment: number;
	readonly isUnion: boolean;

	new <TArrayBuffer extends ArrayBufferLike = ArrayBuffer>(
		buffer?: TArrayBuffer,
		byteOffset?: number,
		byteLength?: number
	): Expand<ArrayBufferView<TArrayBuffer> & T>;
}

function struct<const T extends Record<string, FieldConfigInit>>(
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

	class __struct<TArrayBuffer extends ArrayBufferLike = ArrayBuffer> extends DataView<TArrayBuffer> {
		static readonly name = structName;

		constructor(
			buffer: TArrayBuffer = new ArrayBuffer(size) as TArrayBuffer,
			byteOffset?: number,
			byteLength?: number
		) {
			super(buffer, byteOffset, byteLength ?? size);
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

	const fields = Object.create(null) as Record<keyof T, Field>;
	for (const [_name, init] of Object.entries(fieldDecls) as Entries<T>) {
		if (!_name) throw withErrno('EINVAL', 'Invalid name for struct field');

		if (typeof _name == 'symbol')
			console.warn('Symbol used for struct field name will be coerced to string: ' + _name.toString());
		const name = _name.toString() as keyof T & string;

		const opt = parseFieldConfig(init);

		if (!isType(opt.type)) throw withErrno('EINVAL', `Invalid type for struct field "${name}"`);

		if (opt.countedBy) opt.length ??= 0;

		const field = {
			name,
			offset: 0,
			type: opt.type,
			length: opt.length,
			countedBy: opt.countedBy,
			size: opt.type.size,
			alignment: opt.align ?? opt.type.size,
			decl: `${opt.typeName ?? opt.type.name} ${name}${typeof opt.length === 'number' ? `[${opt.length}]` : opt.countedBy ? `[${opt.countedBy}]` : ''}`,
			littleEndian: !opt.bigEndian,
		} satisfies Field;

		if (!opts.isPacked) align(field.alignment);
		if (opts.isUnion) size = Math.max(size, field.size);
		else {
			field.offset = size;
			size += field.size * (field.length ?? 1);
		}

		fields[name] = field;
		fieldAlignment = Math.max(fieldAlignment, field.alignment);

		Object.defineProperty(_struct.prototype, field.name, {
			enumerable: true,
			configurable: true,
			get() {
				return getField(this, field);
			},
			set(value) {
				setField(this, field, value);
			},
		});
	}

	opts.alignment ??= fieldAlignment;

	if (!opts.isPacked) align(opts.alignment);

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

export { struct };

/**
 * Shortcuts for primitive types that allow easily making arrays
 */
export const types = Object.fromEntries(
	Object.entries(primitive.rawTypes).map(([typeName, type]) => [
		typeName,
		new FieldBuilder<any>(type, { typeName }),
	]) as any
) as { [K in primitive.ValidName]: FieldBuilder<(typeof primitive.rawTypes)[K]> };
