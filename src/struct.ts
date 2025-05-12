import { withErrno } from 'kerium';
import { _throw } from 'utilium/misc.js';
import type { DecoratorContext, Field, Instance, Metadata, Options, StaticLike } from './internal.js';
import { initMetadata } from './internal.js';
import * as primitive from './primitives.js';
import { isType, registerType, type Type } from './types.js';

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

/**
 * Decorates a class as a struct.
 */
export function struct(...options: Options[]) {
	return function __decorateStruct<T extends StaticLike>(
		target: T,
		context: ClassDecoratorContext<T> & DecoratorContext
	): T {
		const opts = options.reduce((acc, opt) => ({ ...acc, ...opt }), {});
		const init = initMetadata(context);

		// Max alignment of all fields
		let fieldAlignment = 1;

		const fields: Record<string, Field> = {};

		let size = 0;

		const align = (to: number) => {
			size = Math.ceil(size / to) * to;
		};

		for (const field of init.fields) {
			if (!opts.isPacked) align(field.alignment);
			if (opts.isUnion) size = Math.max(size, field.size);
			else {
				field.offset = size;
				size += field.size * (field.length ?? 1);
			}

			fields[field.name] = field;
			fieldAlignment = Math.max(fieldAlignment, field.alignment);
		}

		opts.alignment ??= fieldAlignment;

		if (!opts.isPacked) align(opts.alignment);

		context.metadata.struct = {
			fields,
			size,
			alignment: opts.isPacked ? 1 : opts.alignment,
			isUnion: opts.isUnion ?? false,
		} satisfies Metadata;

		// This is so we preserve the name of the class
		// @ts-expect-error
		const struct = class extends target {
			public static readonly name = target.name;

			constructor(...args: any[]) {
				if (!args.length) args = [new ArrayBuffer(size), 0, size];
				super(...args);
			}
		};

		const fix = (value: any) => ({
			writable: false,
			enumerable: false,
			configurable: false,
			value,
		});

		Object.defineProperties(struct, {
			size: fix(size),
			get: fix((buffer: ArrayBufferLike, offset: number) => new struct(buffer, offset)),
			set: fix((buffer: ArrayBufferLike, offset: number, value: InstanceType<T>) => {
				const source = new Uint8Array(value.buffer, value.byteOffset, size);
				const target = new Uint8Array(buffer, offset, size);
				if (value.buffer === buffer && value.byteOffset === offset) return;
				for (let i = 0; i < size; i++) target[i] = source[i];
			}),
		});

		registerType(struct as unknown as Type<InstanceType<T>>);

		return struct;
	};
}

export interface UnionOptions {
	align?: number;
}

/**
 * Decorates a class as a union.
 */
export function union(options: UnionOptions = {}) {
	return struct({ ...options, isUnion: true });
}

export interface FieldOptions {
	bigEndian?: boolean;
	length?: number;
	align?: number;
	typeName?: string;
	countedBy?: string;
}

/**
 * Decorates a class member as a struct field.
 */
export function field<V>(type: Type | StaticLike, opt: FieldOptions = {}) {
	return function __decorateField(value: Target<V>, context: Context<V>): Result<V> {
		if (context.kind != 'accessor') throw withErrno('EINVAL', 'Field must be an accessor');

		const init = initMetadata(context);

		let name = context.name;
		if (typeof name == 'symbol') {
			console.warn('Symbol used for struct field name will be coerced to string: ' + name.toString());
			name = name.toString();
		}

		if (!name) throw withErrno('EINVAL', 'Invalid name for struct field');

		if (!isType(type)) throw withErrno('EINVAL', 'Not a valid type: ' + type.name);

		if (opt.countedBy) opt.length ??= 0;

		const field = {
			name,
			offset: 0, // set when `@struct` is run
			type,
			length: opt.length,
			countedBy: opt.countedBy,
			size: type.size,
			alignment: opt.align ?? type.size,
			decl: `${opt.typeName ?? type.name} ${name}${typeof opt.length === 'number' ? `[${opt.length}]` : opt.countedBy ? `[${opt.countedBy}]` : ''}`,
			littleEndian: !opt.bigEndian,
		} satisfies Field;

		init.fields.push(field);

		return {
			get() {
				return _get(this, field);
			},
			set(value) {
				_set(this, field, value);
			},
		};
	};
}

/** Gets the length of a field */
function _fieldLength<T extends Metadata>(instance: Instance<T>, length?: number, countedBy?: string): number {
	if (length === undefined) return -1;
	if (typeof countedBy == 'string') length = Math.min(length, instance[countedBy]);
	return Number.isSafeInteger(length) && length >= 0
		? length
		: _throw(withErrno('EINVAL', 'Array lengths must be natural numbers'));
}

/** Sets the value of a field */
function _set(instance: Instance, field: Field, value: any, index?: number) {
	const { type, length: maxLength, countedBy } = field;
	const length = _fieldLength(instance, maxLength, countedBy);

	if (length === -1 || typeof index === 'number') {
		if (typeof value == 'string') value = value.charCodeAt(0);
		type.set(instance.buffer, instance.byteOffset + field.offset + (index ?? 0) * type.size, value);
		return;
	}

	for (let i = 0; i < Math.min(length, value.length); i++) {
		const offset = field.offset + i * type.size;
		type.set(instance.buffer, instance.byteOffset + offset, value[i]);
	}
}

/**
 * The value returned when getting a field with an array type.
 */
export type StructArray<T> = ArrayLike<T> & Iterable<T>;

/** Gets the value of a field */
function _get(instance: Instance, field: Field, index?: number) {
	const { type, length: maxLength, countedBy } = field;
	const length = _fieldLength(instance, maxLength, countedBy);

	const offset = instance.byteOffset + field.offset + (index ?? 0) * field.size;

	if (length === -1 || typeof index === 'number') {
		return type.get(instance.buffer, offset);
	}

	if (length !== 0 && type.array) {
		return new type.array(instance.buffer, offset, length * type.size);
	}

	return new Proxy(
		{
			get length() {
				return _fieldLength(instance, field.length, field.countedBy);
			},
			*[Symbol.iterator]() {
				for (let i = 0; i < this.length; i++) yield this[i];
			},
		} satisfies StructArray<any>,
		{
			get(target, index) {
				if (Object.hasOwn(target, index)) return target[index as keyof typeof target];
				const i = parseInt(index.toString());
				if (!Number.isSafeInteger(i)) throw withErrno('EINVAL', 'Invalid index: ' + index.toString());
				return _get(instance, field, i);
			},
			set(target, index, value) {
				const i = parseInt(index.toString());
				if (!Number.isSafeInteger(i)) throw withErrno('EINVAL', 'Invalid index: ' + index.toString());
				_set(instance, field, i, value);
				return true;
			},
		}
	);
}

// Decorator utility types
type Target<V> = ClassAccessorDecoratorTarget<any, V>;
type Result<V> = ClassAccessorDecoratorResult<any, V>;
type Context<V> = ClassAccessorDecoratorContext<any, V> & DecoratorContext;
type Decorator<V> = (value: Target<V>, context: Context<V>) => Result<V>;

function _shortcut<T extends primitive.ValidName>(typeName: T) {
	const type = primitive.types[primitive.normalize(typeName)];

	function __decoratePrimitiveField<V>(length: number, options?: Omit<FieldOptions, 'length'>): Decorator<V>;
	function __decoratePrimitiveField<V>(value: Target<V>, context: Context<V>): Result<V>;
	function __decoratePrimitiveField<V>(
		valueOrLength: Target<V> | number,
		context?: Context<V> | Omit<FieldOptions, 'length'>
	): Decorator<V> | Result<V> {
		return typeof valueOrLength == 'number'
			? field<V>(type, { typeName, length: valueOrLength, ...context })
			: field<V>(type, { typeName })(
					valueOrLength,
					context && 'name' in context
						? context
						: _throw(withErrno('EINVAL', 'Invalid decorator context object'))
				);
	}

	return __decoratePrimitiveField;
}

/**
 * Shortcuts for primitive types
 * Instead of writing `@field(primitive.types[primitive.normalize(<type>)])`, you can write `@types.type`.
 * You can also use `@types.type(length)` for arrays.
 */
export const types = Object.fromEntries(primitive.validNames.map(t => [t, _shortcut(t)])) as {
	[K in primitive.ValidName]: ReturnType<typeof _shortcut<K>>;
};
