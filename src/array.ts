import { withErrno } from 'kerium';
import { _throw } from 'utilium';
import { sizeof } from './misc.js';
import * as primitives from './primitives.js';
import { isStructConstructor, type InstanceOf, type StructConstructor } from './structs.js';
import type { ArrayOf, Type, TypeArrayConstructor, TypeLike, Value } from './types.js';

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

			return new Proxy(this, {
				get(target, index) {
					if (index in target) return target[index as keyof typeof target];
					const i = parseInt(index.toString());
					if (!Number.isSafeInteger(i)) throw withErrno('EINVAL', 'Invalid index: ' + index.toString());
					return type.get(target.buffer, offset(i));
				},
				set(target, index, value) {
					const i = parseInt(index.toString());
					if (!Number.isSafeInteger(i)) throw withErrno('EINVAL', 'Invalid index: ' + index.toString());
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

/**
 * A class used to create any *type* representing an array of a given "inner" or element type.
 */
export class ArrayType<T extends Type = Type> implements Type<ArrayValue<T>> {
	readonly name: string;
	readonly size: number;

	private __structArray: TypeArrayConstructor<Value<T>>;
	private __arrayType: TypeArrayConstructor<Value<T>>;

	constructor(
		readonly type: T,
		readonly length: number
	) {
		this.name = `${type.name}[${length}]`;
		this.size = type.size * length;

		this.array = StructArray(this as Type<ArrayValue<T>>);
		this.__structArray = StructArray<T>(type, length);
		this.__arrayType = type.array ? (type.array as TypeArrayConstructor<Value<T>>) : this.__structArray;
	}

	get = (buffer: ArrayBufferLike, offset: number): ArrayValue<T> => {
		if (primitives.isValid(this.type.name) && offset % this.type.size !== 0) {
			return new this.__structArray(buffer, offset, this.size) as ArrayValue<T>;
		}
		return new this.__arrayType(buffer, offset, this.size) as ArrayValue<T>;
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
					isStructConstructor(this.type) && this.type.isDynamic
						? sizeof(value[i] as TypeLike)
						: this.type.size;
			}
		}
	};

	/**
	 * This is for an array of this array
	 */
	array: TypeArrayConstructor<ArrayValue<T>>;
}
