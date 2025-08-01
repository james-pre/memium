import { withErrno } from 'kerium';
import type { ArrayOf, Type, TypeArrayConstructor, Value } from './types.js';

/**
 * The view on memory used for non-primitive array types.
 * This is a *value*
 */
export function StructArray<T extends Type, N extends number = number>(type: T) {
	class StructArray<TArrayBuffer extends ArrayBufferLike = ArrayBuffer>
		extends DataView<TArrayBuffer>
		implements ArrayLike<Value<T>>, Iterable<Value<T>>
	{
		length: N;

		*[Symbol.iterator]() {
			for (let i = 0; i < this.length; i++) yield this[i];
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
				typeof lengthOrBuffer === 'number' ? lengthOrBuffer : (Math.floor(this.byteLength / type.size) as N);

			return new Proxy(this, {
				get(target, index) {
					if (Object.hasOwn(target, index)) return target[index as keyof typeof target];
					const i = parseInt(index.toString());
					if (!Number.isSafeInteger(i)) throw withErrno('EINVAL', 'Invalid index: ' + index.toString());
					return type.get(target.buffer, target.byteOffset + i * type.size);
				},
				set(target, index, value) {
					const i = parseInt(index.toString());
					if (!Number.isSafeInteger(i)) throw withErrno('EINVAL', 'Invalid index: ' + index.toString());
					type.set(target.buffer, target.byteOffset + i * type.size, value);
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

	return StructArray as typeof StructArray & TypeArrayConstructor<Value<T>>;
}

/**
 * Type used to extract the runtime value type of an `ArrayType`.
 */
export type ArrayValue<T extends Type> = undefined extends T['array']
	? ArrayOf<Value<T>>
	: InstanceType<T['array'] & (new (...args: any[]) => unknown)>;

/**
 * A class used to create any *type* representing an array of a given "inner" or element type.
 */
export class ArrayType<T extends Type = Type> implements Type<ArrayValue<T>> {
	readonly name: string;
	readonly size: number;

	private __arrayType: TypeArrayConstructor<Value<T>>;

	constructor(
		readonly type: T,
		readonly length: number
	) {
		this.name = `${type.name}[${length}]`;
		this.size = type.size * length;

		this.__arrayType = this.type.array
			? (this.type.array as TypeArrayConstructor<Value<T>>)
			: StructArray<T>(this.type);
	}

	get = (buffer: ArrayBufferLike, offset: number): ArrayValue<T> => {
		return new this.__arrayType(buffer, offset, this.size) as ArrayValue<T>;
	};

	set = (buffer: ArrayBufferLike, offset: number, value: ArrayValue<T>): void => {
		for (let i = 0; i < this.length; i++) {
			this.type.set(buffer, offset + i * this.type.size, value[i]);
		}
	};

	array: TypeArrayConstructor<ArrayValue<T>> = StructArray(this as any as Type<ArrayValue<T>>);
}

export function array<T extends Type>(type: T, length: number): ArrayType<T> {
	return new ArrayType(type, length);
}
