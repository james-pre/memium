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
export class Pointer<const T extends Type = Type> extends Number {
	static size = 4;

	static get(this: void, buffer: ArrayBufferLike, offset: number): Pointer<any> {
		return new Pointer(Void, offset);
	}

	static set(this: void, buffer: ArrayBufferLike, offset: number, value: Pointer<any>): void {
		__view(buffer).setUint32(offset, value.valueOf(), true);
	}

	public constructor(
		public type: T,
		address: number,
		public readonly memory: Memory<ArrayBufferLike> = _lastMemory
			?? _throw(new SyntaxError('Missing required memory argument'))
	) {
		super(address);
	}

	public toString(): string {
		return '0x' + this.valueOf().toString(16).padStart(8, '0');
	}

	public toJSON(): PointerJSON {
		return {
			typename: this.type.name,
			address: this.valueOf(),
		};
	}

	/**
	 * Cast the pointer to a different type.
	 */
	public as<C extends Type>(type: C): Pointer<C> {
		return new Pointer(type, this.valueOf(), this.memory);
	}

	public deref(): Value<T> {
		const mem = this.memory.at(this.valueOf());
		return this.type.get(mem.buffer, mem.byteOffset);
	}

	public increment(amount: number = 1): Pointer<T> {
		return new Pointer(this.type, this.valueOf() + amount * this.type.size, this.memory);
	}

	public decrement(amount: number = 1): Pointer<T> {
		return new Pointer(this.type, this.valueOf() - amount * this.type.size, this.memory);
	}
}
