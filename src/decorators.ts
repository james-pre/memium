import { withErrno } from 'kerium';
import { _throw } from 'utilium/misc.js';
import type { FieldOptions } from './fields.js';
import type { DecoratorContext, Field, Metadata, Options, StaticLike } from './internal.js';
import { getField, initMetadata, setField } from './internal.js';
import * as primitive from './primitives.js';
import { isType, registerType, type Type } from './types.js';

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

		abstract class _struct extends target {
			constructor(...args: any[]) {
				if (!args.length) args = [new ArrayBuffer(size), 0, size];
				super(...args);
			}
		}

		const fix = (value: any) => ({
			writable: false,
			enumerable: false,
			configurable: false,
			value,
		});

		Object.defineProperties(_struct, {
			name: fix(opts.name ? opts.name : target.name),
			size: fix(size),
			// @ts-expect-error 2511 : Please don't try to create an instance of an abstract struct
			get: fix((buffer: ArrayBufferLike, offset: number) => new _struct(buffer, offset)),
			set: fix((buffer: ArrayBufferLike, offset: number, value: InstanceType<T>) => {
				const source = new Uint8Array(value.buffer, value.byteOffset, size);
				const target = new Uint8Array(buffer, offset, size);
				if (value.buffer === buffer && value.byteOffset === offset) return;
				for (let i = 0; i < size; i++) target[i] = source[i];
			}),
		});

		for (const field of init.fields) {
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

		registerType(_struct as unknown as Type<InstanceType<T>>);

		return _struct;
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
			type: type as Type<V>,
			length: opt.length,
			countedBy: opt.countedBy,
			size: type.size,
			alignment: opt.align ?? type.size,
			decl: `${opt.typeName ?? type.name} ${name}${typeof opt.length === 'number' ? `[${opt.length}]` : opt.countedBy ? `[${opt.countedBy}]` : ''}`,
			littleEndian: !opt.bigEndian,
		} satisfies Field<Type<V>>;

		init.fields.push(field);

		return {
			get() {
				return getField(this, field) as V;
			},
			set(value) {
				setField(this, field, value);
			},
		};
	};
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
