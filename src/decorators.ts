import { withErrno } from 'kerium';
import type { ClassLike } from 'utilium';
import { _throw } from 'utilium/misc.js';
import { ArrayType } from './array.js';
import type { Options } from './attributes.js';
import * as __field from './fields.internal.js';
import type { Field, FieldConfigInit, FieldOptions } from './fields.js';
import * as primitive from './primitives.js';
import { type StructConstructor, type StructType } from './structs.js';
import { registerType, type Type } from './types.js';

/**
 * Polyfill Symbol.metadata
 * @see https://github.com/microsoft/TypeScript/issues/53461
 */
(Symbol as { metadata: symbol }).metadata ??= Symbol.for('Symbol.metadata');

interface Init {
	fields: Field[];
}

type _DecoratorMetadata<T extends Metadata = Metadata> = DecoratorMetadata & {
	struct?: T;
	structInit?: Init;
};

interface DecoratorContext<T extends Metadata = Metadata> {
	metadata: _DecoratorMetadata<T>;
}

/**
 * Initializes the struct metadata for a class
 * This also handles copying metadata from parent classes
 */
function initMetadata(context: DecoratorContext): Init {
	context.metadata ??= {};

	const existing: Partial<Init> = context.metadata.structInit ?? {};

	context.metadata.structInit = {
		fields: [...(existing.fields ?? [])],
	};

	return context.metadata.structInit;
}

interface Metadata {
	fields: Record<string, Field>;
	size: number;
	alignment: number;

	/** Whether the struct is a union */
	isUnion: boolean;
}

/**
 * Decorates a class as a struct.
 */
export function struct(this: Function | Options | void, ...options: Options[]) {
	const opts = options.reduce((acc, opt) => ({ ...acc, ...opt }), {});
	if (typeof this == 'object') Object.assign(opts, this);

	return function __decorateStruct<T extends ClassLike>(
		target: T,
		context: ClassDecoratorContext<T> & DecoratorContext
	): T {
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
			if (opts.isUnion) size = Math.max(size, field.type.size);
			else {
				field.offset = size;
				size += field.type.size;
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
				for (const field of Object.values(fields)) {
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

		const fix = (value: any) => ({
			writable: false,
			enumerable: false,
			configurable: false,
			value,
		});

		context.addInitializer(function () {
			Object.defineProperties(_struct, {
				size: fix(size),
				alignment: fix(opts.alignment),
				isUnion: fix(!!opts.isUnion),
				fields: fix(fields),
				// @ts-expect-error 2511 : Please don't try to create an instance of an abstract struct
				get: fix((buffer: ArrayBufferLike, offset: number) => new _struct(buffer, offset)),
				set: fix((buffer: ArrayBufferLike, offset: number, value: InstanceType<T>) => {
					const source = new Uint8Array(value.buffer, value.byteOffset, size);
					const target = new Uint8Array(buffer, offset, size);
					if (value.buffer === buffer && value.byteOffset === offset) return;
					for (let i = 0; i < size; i++) target[i] = source[i];
				}),
				[Symbol.toStringTag]: fix(`[struct ${this.name}]`),
			});

			registerType(_struct as unknown as Type<InstanceType<T>>);
		});

		return _struct;
	};
}

struct.packed = struct.bind({ isPacked: true }) as typeof struct;
struct.align = function (alignment: number) {
	return struct.bind({ alignment }) as typeof struct;
};

/**
 * deprecated Use the new `union` function instead.
 */
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
export function field<V>(type: FieldConfigInit | StructConstructor<any>, opt: FieldOptions = {}) {
	return function __decorateField(value: Target<V>, context: Context<V>): Result<V> {
		if (context.kind != 'accessor') throw withErrno('EINVAL', 'Field must be an accessor');

		const init = initMetadata(context);

		const field = __field.init(context.name, type as FieldConfigInit, opt);

		init.fields.push(field);

		return {
			get() {
				return __field.get(this, field) as V;
			},
			set(value) {
				__field.set(this, field, value);
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
			? field<V>(new ArrayType(type, valueOrLength), { typeName, ...context })
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

/**
 * Due to restrictions on decorators, `@struct` can not narrow the type of the class.
 * You must use the function to wrap the base class in the `extends` clause to force the correct type.
 */
export function $from<const T extends {}>(t: ClassLike<T>): StructConstructor<T> {
	return t as any;
}

type TypedArray<T extends ArrayBufferLike = ArrayBufferLike> =
	| Uint8Array<T>
	| Uint16Array<T>
	| Uint32Array<T>
	| Int8Array<T>
	| Int16Array<T>
	| Int32Array<T>
	| Float16Array<T>
	| Float32Array<T>
	| Float64Array<T>
	| BigInt64Array<T>
	| BigUint64Array<T>;

export interface StructFromTypedArray<T extends TypedArray> extends StructType<{}> {
	prototype: T;
	new <TArrayBuffer extends ArrayBufferLike = ArrayBuffer>(
		buffer: TArrayBuffer,
		byteOffset?: number,
		byteLength?: number
	): T;
	new (length: number): T;
	new (array: ArrayLike<number>): T;
	readonly BYTES_PER_ELEMENT?: number;
}

/**
 * Like `$from`, but also adds overloads for TypedArray constructors.
 */
$from.typed = function <const T extends TypedArray>(t: ClassLike<T>): StructFromTypedArray<T> {
	return t as any;
};
