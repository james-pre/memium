import { BufferViewArray } from 'utilium/buffer.js';
import { _debugLog } from 'utilium/debugging.js';
import { _throw } from 'utilium/misc.js';
import { getAllPrototypes } from 'utilium/objects.js';
import type { DecoratorContext, Instance, Field, Metadata, Options, StaticLike } from './internal.js';
import { initMetadata, isInstance, isStatic } from './internal.js';
import * as primitive from './primitives.js';
import { align, sizeof } from './misc.js';

/**
 * Decorates a class as a struct.
 */
export function struct(options: Partial<Options> = {}) {
	return function _decorateStruct<T extends StaticLike>(
		target: T,
		context: ClassDecoratorContext<T> & DecoratorContext
	): void {
		const opt = {
			isUnion: false,
			packed: false,
			align: 1,
			...options,
		};

		const init = initMetadata(context);

		const fields: Record<string, Field> = {};

		for (const field of init.fields) {
			if (opt.isUnion) field.offset = 0;
			fields[field.name] = field;
		}

		context.metadata.struct = {
			...opt,
			fields,
			staticSize: init.size,
			isDynamic: init.isDynamic,
		} satisfies Metadata;
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

		if (init.isDynamic) throw new Error('Dynamically sized fields should be declared at the end of the struct');

		let name = context.name;
		if (typeof name == 'symbol') {
			console.warn('Symbol used for struct field name will be coerced to string: ' + name.toString());
			name = name.toString();
		}

		if (!name) throw new ReferenceError('Invalid name for struct field');

		if (!primitive.isType(type) && !isStatic(type)) throw new TypeError('Not a valid type: ' + type.name);

		if (opt.length === 0) {
			const countedBy = init.fields.find(m => m.name == opt.countedBy);

			if (!countedBy) throw new Error(`"${opt.countedBy}" is not declared and cannot be used to count "${name}"`);

			if (!primitive.isType(countedBy.type))
				throw new Error(`"${opt.countedBy}" is not a number and cannot be used to count "${name}"`);

			init.isDynamic = true;
		}

		const size = sizeof(type) * (opt.length ?? 1);

		// C behavior: the field's offset should be a multiple of the size of its type
		init.size = align(init.size, opt.align ?? sizeof(type)) + size;

		const field = {
			name,
			offset: init.size,
			type,
			length: opt.length,
			countedBy: opt.countedBy,
			size,
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
		if (!isInstance(value)) return _debugLog(`Tried to set "${name}" to a non-instance value`);

		if (length > 0 && typeof index != 'number') {
			for (let i = 0; i < length; i++) _set(instance, field, value[i], i);
			return;
		}

		if (!Array.from(getAllPrototypes(value.constructor)).some(c => c === type))
			throw new Error(`${value.constructor.name} is not a subtype of ${type.name}`);

		const offset = instance.byteOffset + field.offset + (index ?? 0) * sizeof(type);

		// It's already the same value
		if (value.buffer === instance.buffer && value.byteOffset === offset) return;

		const current = new Uint8Array(instance.buffer, offset, sizeof(value));

		current.set(new Uint8Array(value.buffer, value.byteOffset, sizeof(value)));

		return;
	}

	const view = new DataView(instance.buffer, instance.byteOffset, instance.byteLength);

	if (length > 0 && typeof index != 'number') {
		for (let i = 0; i < length; i++) {
			const offset = field.offset + i * type.size;
			type.set(view, offset, field.littleEndian, value[i]);
		}
		return;
	}

	if (typeof value == 'string') value = value.charCodeAt(0);

	type.set(view, field.offset + (index ?? 0) * type.size, field.littleEndian, value);
}

/** Gets the value of a field */
function _get(instance: Instance, field: Field, index?: number) {
	const { type, length: maxLength, countedBy } = field;
	const length = _fieldLength(instance, maxLength, countedBy);

	if (length > 0 && typeof index != 'number') {
		return new (primitive.isType(type) ? type.array : BufferViewArray(type, sizeof(type)))(
			instance.buffer,
			instance.byteOffset + field.offset,
			length * sizeof(type)
		);
	}

	const offset = field.offset + (index ?? 0) * sizeof(type);

	if (isStatic(type)) return new type(instance.buffer, offset, sizeof(type));

	const view = new DataView(instance.buffer, instance.byteOffset, instance.byteLength);
	return type.get(view, offset, field.littleEndian);
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
