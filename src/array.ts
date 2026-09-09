import { withErrno } from 'kerium';
import { _throw, memoize } from 'utilium';
import { sizeof } from './misc.js';
import * as primitives from './primitives.js';
import type { InstanceOf, StructConstructor } from './structs.shared.js';
import type { ArrayOf, Type, TypeArrayConstructor, TypeLike, Value } from './types.js';
import { isArrayType, isType } from './types.js';

let _strictIndexes = false;

export function useStrictArrayIndexes() {
	_strictIndexes = true;
}

/**
 * The view on memory used for non-primitive array types.
 * This is a *value*
 */
export function StructArray<T extends Type, N extends number = number>(type: T, __length?: N) {
	class StructArray<TArrayBuffer extends ArrayBufferLike = ArrayBuffer>
		extends DataView<TArrayBuffer>
		implements ArrayLike<Value<T>>, Iterable<Value<T>>
	{
		readonly length: N;
		readonly type: T = type;

		*[Symbol.iterator]() {
			for (let i = 0; i < this.length; i++) yield this[i];
		}

		private _offsets: number[] = [0];

		private offsetOf(index: number): number {
			if (!type.isDynamic) return index * type.size;

			if (index < this._offsets.length) return this._offsets[index];

			for (let i = this._offsets.length; i <= index; i++) {
				this._offsets[i] =
					this._offsets[i - 1]
					+ sizeof(type.get(this.buffer, this.byteOffset + this._offsets[i - 1]) as TypeLike);
			}

			return this._offsets[index];
		}

		constructor(length: N);
		constructor(buffer?: TArrayBuffer, byteOffset?: number, byteLength?: number);
		constructor(lengthOrBuffer?: TArrayBuffer | N, byteOffset?: number, byteLength?: number) {
			const buffer: TArrayBuffer =
				typeof lengthOrBuffer === 'object'
					? lengthOrBuffer
					: (new ArrayBuffer((lengthOrBuffer ?? 0) * type.size) as TArrayBuffer);

			super(buffer, byteOffset, byteLength);

			this.length =
				typeof lengthOrBuffer === 'number'
					? lengthOrBuffer
					: type.isDynamic
						? (__length ?? _throw(`Unknown length of StructArray<${type.name}>`))
						: (Math.floor(this.byteLength / type.size) as N);

			const offset = (i: number) => this.byteOffset + this.offsetOf(i);

			const views: Value<T>[] | undefined = _isStructConstructor(type) && !type.isDynamic ? [] : undefined;

			return new Proxy(this, {
				get(target, index) {
					if (index in target) return target[index as keyof typeof target];
					const i = parseInt(index.toString());
					if (!Number.isSafeInteger(i))
						if (_strictIndexes) throw withErrno('EINVAL', 'Invalid index: ' + index.toString());
						else return undefined;
					if (!views) return type.get(target.buffer, offset(i));
					return (views[i] ??= type.get(target.buffer, offset(i)) as Value<T>);
				},
				set(target, index, value) {
					const i = parseInt(index.toString());
					if (!Number.isSafeInteger(i))
						if (_strictIndexes) throw withErrno('EINVAL', 'Invalid index: ' + index.toString());
						else return false;
					type.set(target.buffer, offset(i), value);
					return true;
				},
			});
		}

		[K: number]: Value<T>;
	}

	for (const key of Object.getOwnPropertyNames(DataView.prototype)) {
		if (!key.startsWith('get') && !key.startsWith('set')) continue;
		Object.defineProperty(StructArray.prototype, key, {
			enumerable: false,
			configurable: false,
			writable: false,
			value: undefined,
		});
	}

	return StructArray as TypeArrayConstructor<Value<T>>;
}

/**
 * Type used to extract the runtime value type of an `ArrayType`.
 */
export type ArrayValue<T extends Type> = undefined extends T['array']
	? ArrayOf<T extends StructConstructor<any> ? InstanceOf<T> : Value<T>>
	: InstanceType<T['array'] & (new (...args: any[]) => unknown)>;

function _isStructConstructor(arg: unknown): arg is StructConstructor<any> {
	return (
		typeof arg == 'function'
		&& 'prototype' in arg
		&& 'fields' in arg
		&& typeof arg.fields == 'object'
		&& isType(arg)
	);
}

/**
 * A class used to create any *type* representing an array of a given "inner" or element type.
 */
export class ArrayType<T extends Type = Type> implements Type<ArrayValue<T>> {
	readonly name: string;
	readonly size: number;

	// Defining a `StructArray` class is expensive, and most array types never need one
	@memoize
	private get __structArray(): TypeArrayConstructor<Value<T>> {
		return StructArray<T>(this.type, this.length);
	}

	@memoize
	private get __arrayType(): TypeArrayConstructor<Value<T>> {
		return this.type.array ? (this.type.array as TypeArrayConstructor<Value<T>>) : this.__structArray;
	}

	/** @internal @hidden */
	readonly __isArrayType = true;

	/**
	 * The "root" type of the array.
	 * For example, `uint8` for `uint8[x][y]`
	 */
	readonly baseType: Type;

	/**
	 * Use `ArrayType.for()` instead!
	 * @todo [breaking] make this protected
	 * @internal
	 */
	constructor(
		readonly type: T,
		readonly length: number
	) {
		this.name = `${type.name}[${length}]`;
		this.size = type.size * length;

		this.baseType = type;
		while (isArrayType(this.baseType)) this.baseType = this.baseType.type;
	}

	/** Array types are immutable and fully described by their name, so they can be shared. */
	protected static _cache = new Map<string, ArrayType<any>>();

	/** Get the array type for an element type and length, reusing an existing one when possible. */
	static for<T extends Type>(type: T, length: number): ArrayType<T> {
		const name = `${type.name}[${length}]`;

		// @todo replace with `return this._cache.getOrInsertComputed(name, () => new ArrayType(type, length));` once `getOrInsertComputed` is more widespread
		let arrayType = this._cache.get(name);
		if (!arrayType) this._cache.set(name, (arrayType = new ArrayType(type, length)));

		return arrayType;
	}

	get = (buffer: ArrayBufferLike, offset: number): ArrayValue<T> => {
		const isPrimitive = primitives.isValid(this.type.name);
		if (isPrimitive && offset % this.type.size !== 0) {
			return new this.__structArray(buffer, offset, this.size) as ArrayValue<T>;
		}
		return new this.__arrayType(buffer, offset, isPrimitive ? this.length : this.size) as ArrayValue<T>;
	};

	set = (buffer: ArrayBufferLike, offset: number, value: ArrayValue<T>): void => {
		if (this.length)
			for (let i = 0; i < this.length; i++) {
				this.type.set(buffer, offset + i * this.type.size, value[i]);
			}
		else {
			let pointer = offset;
			for (let i = 0; i < value.length; i++) {
				this.type.set(buffer, pointer, value[i]);
				pointer +=
					_isStructConstructor(this.type) && this.type.isDynamic
						? sizeof(value[i] as TypeLike)
						: this.type.size;
			}
		}
	};

	/**
	 * This is for an array of this array
	 */
	@memoize
	get array(): TypeArrayConstructor<ArrayValue<T>> {
		return StructArray(this as Type<ArrayValue<T>>);
	}
}
