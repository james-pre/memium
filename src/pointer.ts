import type { Type, Value } from './types.js';
import { isStatic } from './internal.js';
import { sizeof } from './misc.js';
import { defaultMemory } from './memory.js';
import type { PagedMemory } from './pages.js';

export interface PointerJSON {
	typename: string;
	address: number;
}

/**
 * A
 */
export class Pointer<const T extends Type> extends Number {
	buffer: ArrayBufferLike;
	byteOffset: number;
	constructor(
		public type: T,
		address: number,
		public readonly memory: PagedMemory = defaultMemory
	) {
		super(address);
		const mem = memory.at(address);
		this.buffer = mem.buffer;
		this.byteOffset = mem.byteOffset;
	}

	toString(): string {
		return '0x' + this.valueOf().toString(16).padStart(8, '0');
	}

	toJSON(): PointerJSON {
		return {
			typename: this.type.name,
			address: this.valueOf(),
		};
	}

	deref(): Value<T> {
		const u8 = this.memory.at(this.valueOf());

		if (isStatic(this.type)) {
			return new this.type(u8) as Value<T>;
		}

		return this.type.get(u8.buffer, this.byteOffset);
	}

	increment(amount: number = 1): Pointer<T> {
		return new Pointer(this.type, this.valueOf() + amount * sizeof(this.type), this.memory);
	}

	decrement(amount: number = 1): Pointer<T> {
		return new Pointer(this.type, this.valueOf() - amount * sizeof(this.type), this.memory);
	}
}
