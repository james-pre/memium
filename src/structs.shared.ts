import type { Expand } from 'utilium';
import type { Field, FieldConfigInit, FieldValue } from './fields.js';
import { isType, type Type } from './types.js';
import { dynamicArraySize, isDynamicArray } from './fields.internal.js';

export type StructInstance<
	T extends {},
	TArrayBuffer extends ArrayBufferLike = ArrayBuffer,
> = ArrayBufferView<TArrayBuffer> & {
	constructor: StructConstructor<T>;
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
}

export interface StructConstructor<T extends {}> extends StructType<T> {
	prototype: StructInstance<T>;

	new <TArrayBuffer extends ArrayBufferLike = any>(
		buffer?: TArrayBuffer,
		byteOffset?: number,
		byteLength?: number
	): Expand<StructInstance<T, TArrayBuffer>>;
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
