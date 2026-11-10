import type { Expand } from 'utilium';
import type { Field, FieldConfigInit, FieldValue } from './fields.js';
import { isType, type Type } from './types.js';
import { dynamicArraySize, get, isDynamicArray, set } from './fields.internal.js';

export type StructInstance<
	T extends {},
	TArrayBuffer extends ArrayBufferLike = ArrayBuffer,
> = ArrayBufferView<TArrayBuffer> & {
	constructor: StructConstructor<T>;
	readonly [Symbol.toStringTag]: string;
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
	/** Whether fields are only served from the prototype */
	readonly fastFields?: boolean;
}

export interface StructConstructor<T extends {}> extends StructType<T> {
	prototype: StructInstance<T>;

	new <TArrayBuffer extends ArrayBufferLike = any>(
		buffer?: TArrayBuffer,
		byteOffset?: number,
		byteLength?: number
	): Expand<StructInstance<T, TArrayBuffer>>;
}

/**
 * A struct created by `struct.extend`.
 * Its instances are also instances of `Base`, including anything a subclass of a struct adds.
 */
export interface ExtendedStructConstructor<Base extends StructConstructor<any>, T extends {}>
	extends StructType<InstanceType<Base> & T> {
	prototype: InstanceType<Base> & T;

	new <TArrayBuffer extends ArrayBufferLike = any>(
		buffer?: TArrayBuffer,
		byteOffset?: number,
		byteLength?: number
	): InstanceType<Base> & T;
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

/**
 * Gets the dynamic size in bytes of a struct instance.
 * This *does not* include the static size of the struct.
 */
export function dynamicStructSize<T extends {}>(instance: StructInstance<T>): number {
	let size = 0;

	for (const field of instance.constructor.fields) {
		const value = instance[field.name];
		if (isDynamicArray(instance, field)) {
			size += dynamicArraySize(instance, field);
		}

		if (isStructInstance(value) && value.constructor.isDynamic) {
			size += dynamicStructSize(value);
		}
	}

	return size;
}

const kDescriptors = Symbol('kDescriptors');

/**
 * Enumerable accessors for a struct's fields.
 * They are identical for every instance, so they are built once per struct rather than allocating a descriptor and a pair of closures per field on every construction.
 */
export function descriptorsOf<T extends {}>(
	struct: StructConstructor<T> & { [kDescriptors]?: PropertyDescriptorMap }
): PropertyDescriptorMap {
	// Own, not inherited: a struct extending another has its own field list to describe.
	if (Object.hasOwn(struct, kDescriptors)) return struct[kDescriptors]!;

	const descriptors: PropertyDescriptorMap = {};

	for (const field of struct.fields) {
		descriptors[field.name] = {
			enumerable: true,
			configurable: true,
			get(this: StructInstance<T>) {
				return get(this, field);
			},
			set(this: StructInstance<T>, value: any) {
				set(this, field, value);
			},
		};
	}

	Object.defineProperty(struct, kDescriptors, { value: descriptors, configurable: true });
	return descriptors;
}

/**
 * Installs a struct's field accessors on its prototype, so instances don't have to carry their own.
 * Instances are also tagged with the struct's name.
 */
export function defineStructPrototype<T extends {}>(struct: StructConstructor<T>): void {
	Object.defineProperties(struct.prototype, {
		...descriptorsOf(struct),
		[Symbol.toStringTag]: { get: () => struct.name, configurable: true },
	});
}
