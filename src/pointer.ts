import type { Type, Value } from '../src/internal.js';
import { isStatic } from '../src/internal.js';
import { sizeof } from '../src/misc.js';
import { defaultMemory } from './memory.js';
import type { PagedMemory } from './pages.js';

class Pointer<const T extends Type> extends Number {
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

	deref(): Value<T> {
		const u8 = this.memory.at(this.valueOf());

		if (isStatic(this.type)) {
			return new this.type(u8) as Value<T>;
		}

		return this.type.get(new DataView(u8.buffer, u8.byteOffset, u8.byteLength), this.valueOf(), true);
	}

	increment(amount: number = 1): Pointer<T> {
		return new Pointer(this.type, this.valueOf() + amount * sizeof(this.type), this.memory);
	}

	decrement(amount: number = 1): Pointer<T> {
		return new Pointer(this.type, this.valueOf() - amount * sizeof(this.type), this.memory);
	}
}
