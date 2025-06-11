import { _throw } from 'utilium';
import type { Memory } from './memory.js';
import { _lastMemory } from './memory.js';
import { registerType, Void, type Type, type Value } from './types.js';
import { __view } from './primitives.js';

export interface PointerJSON {
	typename: string;
	address: number;
}

/**
 * A pointer
 */
@registerType
export class Pointer<const T extends Type = Type> {
	static readonly name = 'Pointer';

	static size = 4;

	static get(this: void, buffer: ArrayBufferLike, offset: number): Pointer<any> {
		return new Pointer(Void, offset);
	}

	static set(this: void, buffer: ArrayBufferLike, offset: number, value: Pointer<any>): void {
		__view(buffer).setUint32(offset, value.valueOf(), true);
	}

	#value: number;

	public constructor(
		public type: T,
		value: number,
		public readonly memory: Memory<ArrayBufferLike> = _lastMemory
			?? _throw(new SyntaxError('Missing required memory argument'))
	) {
		this.#value = value;
	}

	public toString(): string {
		return '0x' + this.#value.toString(16).padStart(8, '0');
	}

	public toJSON(): PointerJSON {
		return {
			typename: this.type.name,
			address: this.#value,
		};
	}

	public valueOf(): number {
		return this.#value;
	}

	public [Symbol.toPrimitive](): number {
		return this.#value;
	}

	public set(newAddress: number | Pointer<any>): this {
		this.#value = newAddress.valueOf();
		return this;
	}

	public add(amount: number): this {
		this.#value += amount * this.type.size;
		return this;
	}

	/**
	 * Cast the pointer to a different type.
	 */
	public as<C extends Type>(type: C): Pointer<C> {
		return new Pointer(type, this.#value, this.memory);
	}

	public deref(): Value<T> {
		const mem = this.memory.at(this.#value);
		return this.type.get(mem.buffer, mem.byteOffset);
	}
}
