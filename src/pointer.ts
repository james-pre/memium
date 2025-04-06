import { _throw } from 'utilium';
import type { Memory } from './memory.js';
import { _lastMemory } from './memory.js';
import type { Type, Value } from './types.js';

export interface PointerJSON {
	typename: string;
	address: number;
}

/**
 * A
 */
export class Pointer<const T extends Type> extends Number {
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
