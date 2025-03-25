import { _throw } from 'utilium/misc.js';
import { getAllPrototypes } from 'utilium/objects.js';
import type { DecoratorContext, Field, Instance, Metadata, Options, StaticLike } from './internal.js';
import { initMetadata, isInstance, isStatic } from './internal.js';
import { sizeof } from './misc.js';
import * as primitive from './primitives.js';

const __view__ = Symbol('DataView');

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
				size += field.size;
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
		return new Function(
			'target',
			'size',
			'__view__',
			`return class ${target.name} extends target {
				constructor(...args) {
					if (!args.length) args = [new ArrayBuffer(size), 0, size];
					super(...args);
					this[__view__] = new DataView(this.buffer, this.byteOffset, this.byteLength);
				}
			}`
		)(target, size, __view__);
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
export function field<V>(type: primitive.Type | StaticLike, opt: FieldOptions = {}) {
	return function __decorateField(value: Target<V>, context: Context<V>): Result<V> {
		if (context.kind != 'accessor') throw new Error('Field must be an accessor');

		const init = initMetadata(context);

		let name = context.name;
		if (typeof name == 'symbol') {
			console.warn('Symbol used for struct field name will be coerced to string: ' + name.toString());
			name = name.toString();
		}

		if (!name) throw new ReferenceError('Invalid name for struct field');

		if (!primitive.isType(type) && !isStatic(type)) throw new TypeError('Not a valid type: ' + type.name);

		const alignment = opt.align ?? (primitive.isType(type) ? type.size : type[Symbol.metadata].struct.alignment);

		const size = sizeof(type) * (opt.length ?? 1);

		const field = {
			name,
			offset: 0, // Note: set when `@struct` is run
			type,
			length: opt.length,
			countedBy: opt.countedBy,
			size,
			alignment,
			decl: `${opt.typeName ?? type.name} ${name}${opt.length !== undefined ? `[${JSON.stringify(opt.length)}]` : ''}`,
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
		: _throw(new Error('Array lengths must be natural numbers'));
}

/** Sets the value of a field */
function _set(instance: Instance, field: Field, value: any, index?: number) {
	const { name, type, length: maxLength, countedBy } = field;
	const length = _fieldLength(instance, maxLength, countedBy);

	if (!primitive.isType(type)) {
		if (length !== -1 && typeof index != 'number') {
			for (let i = 0; i < Math.min(length, value.length); i++) _set(instance, field, value[i], i);
			return;
		}
		if (!isInstance(value)) throw new Error(`Tried to set "${name}" to a non-instance value`);

		if (!Array.from(getAllPrototypes(value.constructor)).some(c => c === type))
			throw new Error(`${value.constructor.name} is not a subtype of ${type.name}`);

		const offset = instance.byteOffset + field.offset + (index ?? 0) * sizeof(type);

		// It's already the same value
		if (value.buffer === instance.buffer && value.byteOffset === offset) return;

		new Uint8Array(instance.buffer, offset).set(new Uint8Array(value.buffer, value.byteOffset, sizeof(value)));
		return;
	}

	if (length === -1 || typeof index === 'number') {
		if (typeof value == 'string') value = value.charCodeAt(0);
		type.set(instance[__view__], field.offset + (index ?? 0) * type.size, field.littleEndian, value);
		return;
	}

	for (let i = 0; i < length; i++) {
		const offset = field.offset + i * type.size;
		type.set(instance[__view__], offset, field.littleEndian, value[i]);
	}
}

/** Gets the value of a field */
function _get(instance: Instance, field: Field, index?: number) {
	const { type, length: maxLength, countedBy } = field;
	const length = _fieldLength(instance, maxLength, countedBy);

	if (length === -1 || typeof index === 'number') {
		const size = primitive.isType(type) ? type.size : type[Symbol.metadata].struct.size;

		const offset = field.offset + (index ?? 0) * size;

		if (isStatic(type)) return new type(instance.buffer, offset, size);

		return type.get(instance[__view__], offset, field.littleEndian);
	}

	if (length !== 0 && primitive.isType(type)) {
		return new type.array(instance.buffer, instance.byteOffset + field.offset, length * sizeof(type));
	}

	return new Proxy(
		{},
		{
			get(target, index) {
				const i = parseInt(index.toString());
				if (!Number.isSafeInteger(i)) throw new Error('Invalid index: ' + index.toString());
				return _get(instance, field, i);
			},
			set(target, index, value) {
				const i = parseInt(index.toString());
				if (!Number.isSafeInteger(i)) throw new Error('Invalid index: ' + index.toString());
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

function _shortcut<T extends primitive.Valid>(typeName: T) {
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
					context && 'name' in context ? context : _throw('Invalid decorator context object')
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
	[K in primitive.Valid]: ReturnType<typeof _shortcut<K>>;
};
