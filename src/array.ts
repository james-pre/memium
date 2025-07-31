import { withErrno } from 'kerium';
import { FixedView } from './fixed_view.js';
import type { Type, Value } from './types.js';

export interface StructArrayInstance<TArrayBuffer extends ArrayBufferLike = ArrayBuffer>
	extends FixedView<TArrayBuffer> {}

export interface StructArrayConstructor {
	readonly prototype: StructArrayInstance<ArrayBufferLike>;
	new <TArrayBuffer extends ArrayBufferLike & { BYTES_PER_ELEMENT?: never }>(
		buffer?: TArrayBuffer,
		byteOffset?: number,
		byteLength?: number
	): StructArrayInstance<TArrayBuffer>;
}

function StructArray<T extends Type>(type: T, length: number) {
	const size = type.size * length;

	return class StructArray<TArrayBuffer extends ArrayBufferLike = ArrayBuffer> extends FixedView(size)<TArrayBuffer> {
		readonly length = length;

		*[Symbol.iterator]() {
			for (let i = 0; i < this.length; i++) yield this[i];
		}

		constructor(buffer?: TArrayBuffer, byteOffset?: number, byteLength?: number) {
			super(buffer, byteOffset, byteLength);

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
	};
}

type StructArray<T extends Type> = InstanceType<ReturnType<typeof StructArray<T>>>;

type ArrayValue<T extends Type, N extends number> = ArrayLike<Value<T>> & { readonly length: N };

export class ArrayType<T extends Type, N extends number = number> implements Type<ArrayValue<T, N>> {
	readonly name: string;
	readonly size: number;

	constructor(
		readonly type: T,
		readonly length: N
	) {
		this.name = `${this.type.name}[${this.length}]`;
		this.size = this.type.size * this.length;
	}

	get = (buffer: ArrayBufferLike, offset: number): ArrayValue<T, N> => {
		const array_t = this.type.array || StructArray(this.type, this.length);
		return new array_t(buffer, offset, this.size) as ArrayValue<T, any>;
	};

	set = (buffer: ArrayBufferLike, offset: number, value: ArrayValue<T, N>): void => {
		for (let i = 0; i < this.length; i++) {
			this.type.set(buffer, offset + i * this.type.size, value[i]);
		}
	};
}

export function array<T extends Type, N extends number>(type: T, length: N): ArrayType<T, N> {
	return new ArrayType(type, length);
}
