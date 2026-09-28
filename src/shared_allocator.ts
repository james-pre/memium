import Allocator from './allocator.js';
import type { MemoryUsage } from './memory.js';

const initValue = 1;

/** Lock acquisition attempts before sleeping. */
const contentionSpins = 100;

let canSuspend: boolean | undefined;

try {
	Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 1, 0);
	canSuspend = true;
} catch {
	canSuspend = false;
}

/**
 * An `Allocator` that any number of threads can use concurrently on the same heap.
 * @experimental
 */
export default class SharedAllocator extends Allocator {
	declare public readonly buffer: SharedArrayBuffer;
	declare protected heap: Int32Array<SharedArrayBuffer>;

	public constructor(buffer: SharedArrayBuffer, byteOffset?: number) {
		super(buffer, byteOffset);
	}

	protected override setup(): void {
		const { buffer } = this;
		const bytes = (this.base + Allocator.metaSize) * 4;

		if (buffer.byteLength < bytes) {
			try {
				buffer.grow(bytes);
			} catch (e) {
				if (buffer.byteLength < bytes) throw e;
			}
		}

		this.remap();

		const i = this.base;

		for (;;) {
			const state = Atomics.compareExchange(this.heap, i, 0, initValue);

			if (state === Allocator.magic) return;

			if (!state) {
				try {
					this.format();
				} catch (e) {
					Atomics.store(this.heap, i, 0);
					Atomics.notify(this.heap, i);
					throw e;
				}
				Atomics.store(this.heap, i, Allocator.magic);
				Atomics.notify(this.heap, i);
				return;
			}

			if (state !== initValue) throw new TypeError('Buffer contains data that is not a heap');

			if (canSuspend) Atomics.wait(this.heap, i, initValue);
		}
	}

	/** Acquires the heap lock and remaps `heap` if another thread grew the buffer. */
	#lock(): void {
		const i = this.base + Allocator.lockIndex;
		if (Atomics.compareExchange(this.heap, i, 0, 1)) this.#contend(this.heap, i);
		if (this.heap[this.base + Allocator.brkSize] > this.heap.length) this.remap();
	}

	#contend(heap: Int32Array<SharedArrayBuffer>, i: number): void {
		for (let n = 0; n < contentionSpins; n++) {
			if (!Atomics.load(heap, i) && !Atomics.compareExchange(heap, i, 0, 1)) return;
		}

		while (Atomics.exchange(heap, i, 2)) if (canSuspend) Atomics.wait(heap, i, 2);
	}

	#unlock(): void {
		const i = this.base + Allocator.lockIndex;
		if (Atomics.sub(this.heap, i, 1) === 1) return;
		Atomics.store(this.heap, i, 0);
		Atomics.notify(this.heap, i, 1);
	}

	public override alloc(size: number): number {
		this.#lock();
		try {
			return super.alloc(size);
		} finally {
			this.#unlock();
		}
	}

	public override free(ptr: number): void {
		if (!ptr) return;
		this.#lock();
		try {
			super.free(ptr);
		} finally {
			this.#unlock();
		}
	}

	public override realloc(ptr: number, size: number): number {
		this.#lock();
		try {
			return super.realloc(ptr, size);
		} finally {
			this.#unlock();
		}
	}

	public override usage(): MemoryUsage {
		this.#lock();
		try {
			return super.usage();
		} finally {
			this.#unlock();
		}
	}
}
