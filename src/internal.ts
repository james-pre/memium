/* Internal stuff used for structs */
import type { ClassLike } from 'utilium/types.js';
import type * as primitive from './primitives.js';

/**
 * Polyfill Symbol.metadata
 * @see https://github.com/microsoft/TypeScript/issues/53461
 */
(Symbol as { metadata: symbol }).metadata ??= Symbol.for('Symbol.metadata');

export type TypeLike = primitive.Type | Like | primitive.Valid | undefined | null;

export type Type = Static | primitive.Type;

export type Value<T extends Type> = T extends Static ? InstanceType<T> : T extends 'uint64' | 'int64' ? bigint : number;

/**
 * Options for struct initialization
 */
export interface Options {
	alignment?: number;
	isPacked?: boolean;
	/** Whether the struct is a union */
	isUnion?: boolean;
}

export interface Field {
	name: string;
	type: Type;
	offset: number;

	/** The size of the field, 0 for dynamically sized arrays */
	size: number;

	alignment: number;
	length?: number;
	countedBy?: string;

	/** A C-style type/name declaration string, used for diagnostics */
	decl: string;

	/** Whether the field is little endian */
	littleEndian: boolean;
}

export interface Metadata {
	fields: Record<string, Field>;
	size: number;
	alignment: number;

	/** Whether the struct is a union */
	isUnion: boolean;
}

export interface Init {
	fields: Field[];
}

type _DecoratorMetadata<T extends Metadata = Metadata> = DecoratorMetadata & {
	struct?: T;
	structInit?: Init;
};

export interface DecoratorContext<T extends Metadata = Metadata> {
	metadata: _DecoratorMetadata<T>;
}

/**
 * Initializes the struct metadata for a class
 * This also handles copying metadata from parent classes
 */
export function initMetadata(context: DecoratorContext): Init {
	context.metadata ??= {};

	const existing: Partial<Init> = context.metadata.structInit ?? {};

	context.metadata.structInit = {
		fields: [...(existing.fields ?? [])],
	};

	return context.metadata.structInit;
}

export interface Static<M extends Metadata = Metadata, I extends Instance<M> = Instance<M>> {
	[Symbol.metadata]: Required<_DecoratorMetadata<M>>;
	readonly prototype: I;
	new (length?: number): I;
	new (buffer: ArrayBufferLike, byteOffset?: number, length?: number): I;
	new (array: ArrayLike<number> | ArrayBuffer): I;
}

export interface StaticLike<T extends Metadata = Metadata> extends ClassLike {
	[Symbol.metadata]?: _DecoratorMetadata<T> | null;
}

export function isValidMetadata<T extends Metadata = Metadata>(
	arg: unknown
): arg is DecoratorMetadata & {
	struct: T;
} {
	return arg != null && typeof arg == 'object' && 'struct' in arg;
}

export function isStatic<T extends Metadata = Metadata>(arg: unknown): arg is Static<T> {
	return typeof arg == 'function' && Symbol.metadata in arg && isValidMetadata(arg[Symbol.metadata]);
}

export interface Instance<T extends Metadata = Metadata> extends ArrayBufferView, Record<PropertyKey, any> {
	constructor: Static<T>;
}

export interface InstanceLike<T extends Metadata = Metadata> {
	constructor: StaticLike<T>;
}

export function isInstance<T extends Metadata = Metadata>(arg: unknown): arg is Instance<T> {
	return arg != null && typeof arg == 'object' && isStatic(arg.constructor);
}

export function checkInstance<T extends Metadata = Metadata>(
	arg: unknown
): asserts arg is Instance<T> & Record<keyof any, any> {
	if (isInstance(arg)) return;
	throw new TypeError(
		(typeof arg == 'function' ? arg.name : typeof arg == 'object' && arg ? arg.constructor.name : arg)
			+ ' is not a struct instance'
	);
}

export function isStruct<T extends Metadata = Metadata>(arg: unknown): arg is Instance<T> | Static<T> {
	return isInstance(arg) || isStatic(arg);
}

export function checkStruct<T extends Metadata = Metadata>(arg: unknown): asserts arg is Instance<T> | Static<T> {
	if (isStruct(arg)) return;
	throw new TypeError(
		(typeof arg == 'function' ? arg.name : typeof arg == 'object' && arg ? arg.constructor.name : arg)
			+ ' is not a struct'
	);
}

export type Like<T extends Metadata = Metadata> = InstanceLike<T> | StaticLike<T>;

export type Size<T extends TypeLike> = T extends undefined | null
	? 0
	: T extends primitive.Valid
		? primitive.Size<T>
		: number;
