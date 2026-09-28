import type { MemoryUsage } from './memory.js';

const enum Alloc {
	Free,
	This,
	Prev,
}

const minBlockSize = 4;
const chunkSize = 1024;
/** Granularity of buffer growth, in bytes. */
const growStep = 0x10000;
/** Blocks at least this size are placed at the end of a free block. */
const highSize = 24;

const numBins = 160;
const bitmapWords = numBins >>> 5;

/** Largest request, in bytes. */
const maxSize = 2 ** 32 - 16;

const bitmapSize = 3;
const headsSize = bitmapSize + bitmapWords;

function blockSize(size: number): number {
	return size <= 12 ? minBlockSize : ((size + 11) >>> 3) << 1;
}

function binOf(size: number): number {
	return size <= 256 ? size >>> 1 : Math.min(numBins - 1, 160 - Math.clz32(size >>> 8));
}

/**
 * Segregated explicit free-list allocator.
 * @experimental
 */
export default class Allocator {
	protected heap: Int32Array<ArrayBufferLike>;

	/** Word index of the heap metadata. */
	protected readonly base: number;

	/** Word index the heap may not grow past. */
	protected readonly limit: number;

	protected static readonly magic = 0x6d6d3332;
	protected static readonly lockIndex = 1;
	protected static readonly brkSize = 2;
	/** Words before the first block, including padding and the initial epilogue. @internal */
	protected static readonly metaSize = headsSize + numBins + 2;

	/**
	 * Attaches to the heap at `byteOffset` in `buffer`, formatting one if that region is zeroed.
	 */
	public constructor(
		public readonly buffer: ArrayBufferLike,
		byteOffset: number = 0
	) {
		if (!Number.isSafeInteger(byteOffset) || byteOffset < 0 || byteOffset % 8)
			throw new RangeError('Heap offset must be a non-negative multiple of 8');

		this.heap = new Int32Array(buffer, 0, Math.floor(buffer.byteLength / 4));
		this.base = byteOffset / 4;
		this.limit = Math.floor(Math.min(buffer.maxByteLength, 2 ** 32) / 8) * 2;

		if (this.limit < this.base + Allocator.metaSize + minBlockSize)
			throw new RangeError('Buffer is too small for a heap');

		this.setup();
	}

	protected setup(): void {
		this.#reserve(this.base + Allocator.metaSize);

		const state = this.heap[this.base];
		if (state === Allocator.magic) return;
		if (state) throw new TypeError('Buffer contains data that is not a heap');

		this.format();
		this.heap[this.base] = Allocator.magic;
	}

	/** Writes an empty heap, leaving the state word untouched. */
	protected format(): void {
		const heap = this.heap,
			base = this.base;
		heap.fill(0, base + 1, base + Allocator.metaSize);
		heap[base + Allocator.brkSize] = base + Allocator.metaSize;
		heap[base + Allocator.metaSize - 1] = Alloc.This | Alloc.Prev;
		this.#extend(chunkSize, minBlockSize);
	}

	/**
	 * Allocates at least `size` bytes.
	 * @returns The 8-byte aligned byte offset of the allocation in `buffer`, or 0 if out of memory.
	 */
	public alloc(size: number): number {
		return size > 0 && size <= maxSize ? this.#allocate(blockSize(size)) * 4 : 0;
	}

	/**
	 * Frees an allocation. Freeing 0 does nothing.
	 */
	public free(ptr: number): void {
		if (ptr) this.#release(ptr >>> 2);
	}

	/**
	 * Resizes an allocation, moving it if needed.
	 * Reallocating 0 is `alloc` and reallocating to size 0 is `free`.
	 * @returns The new byte offset, or 0 if out of memory, in which case `ptr` is left untouched.
	 */
	public realloc(ptr: number, size: number): number {
		if (!(size > 0 && size <= maxSize)) {
			if (!size && ptr) this.#release(ptr >>> 2);
			return 0;
		}

		const asize = blockSize(size);
		if (!ptr) return this.#allocate(asize) * 4;

		const bp = ptr >>> 2,
			hdr = this.heap[bp - 1],
			old = hdr >>> 2;

		if (asize <= old) return ptr;

		const next = bp + old;
		let nh = this.heap[next - 1];
		let nsize = nh >>> 2;

		if (!nsize) {
			const need = Math.max(asize - old, minBlockSize);
			if (!this.#extend(need, need)) return 0;
			nh = this.heap[next - 1];
			nsize = nh >>> 2;
		} else if (!(nh & Alloc.This) && !(this.heap[next + nsize - 1] >>> 2) && old + nsize < asize) {
			const need = Math.max(asize - old - nsize, minBlockSize);
			if (!this.#extend(need, need)) return 0;
			nh = this.heap[next - 1];
			nsize = nh >>> 2;
		}

		if (!(nh & Alloc.This) && old + nsize >= asize) {
			this.#unlink(next, nsize);
			const total = old + nsize;
			this.heap[bp - 1] = (total << 2) | (hdr & Alloc.Prev) | Alloc.This;
			this.heap[bp + total - 1] |= Alloc.Prev;
			return ptr;
		}

		if (!(hdr & Alloc.Prev)) {
			const psize = this.heap[bp - 2] >>> 2;
			let total = old + psize;
			const withNext = total < asize && !(nh & Alloc.This) && total + nsize >= asize;

			if (total >= asize || withNext) {
				const prev = bp - psize;
				this.#unlink(prev, psize);
				if (withNext) {
					this.#unlink(next, nsize);
					total += nsize;
					this.heap[prev + total - 1] |= Alloc.Prev;
				}
				this.heap.copyWithin(prev, bp, bp + old - 1);
				this.heap[prev - 1] = (total << 2) | Alloc.This | Alloc.Prev;
				return prev * 4;
			}
		}

		const moved = this.#allocate(asize);
		if (!moved) return 0;

		this.heap.copyWithin(moved, bp, bp + old - 1);
		this.#release(bp);
		return moved * 4;
	}

	/**
	 * Byte counts of the heap; `used` and `free` include block headers.
	 */
	public usage(): MemoryUsage {
		const heap = this.heap;
		let used = 0,
			free = 0;

		for (let bp = this.base + Allocator.metaSize, size: number; (size = heap[bp - 1] >>> 2); bp += size) {
			if (heap[bp - 1] & Alloc.This) used += size;
			else free += size;
		}

		return { total: (heap[this.base + Allocator.brkSize] - this.base) * 4, used: used * 4, free: free * 4 };
	}

	#allocate(asize: number): number {
		const heap = this.heap;
		const heads = this.base + headsSize;
		let bin = binOf(asize);
		let bp = heap[heads + bin];

		while (bp && heap[bp - 1] >>> 2 < asize) bp = heap[bp + 1];

		if (!bp) {
			bin = this.#findBin(bin + 1);
			if (bin >= 0) bp = heap[heads + bin];
			else {
				const brk = heap[this.base + Allocator.brkSize];
				const tail = heap[brk - 1] & Alloc.Prev ? 0 : heap[brk - 2] >>> 2;
				const need = Math.max(asize - tail, minBlockSize);
				bp = this.#extend(Math.max(need, chunkSize), need);
				if (!bp) return 0;
			}
		}

		return this.#place(bp, asize);
	}

	/** Allocates `asize` words from the free block at `bp`, splitting off any usable remainder. */
	#place(bp: number, asize: number): number {
		const heap = this.heap;
		const size = heap[bp - 1] >>> 2;
		const rest = size - asize;

		this.#unlink(bp, size);

		if (rest < minBlockSize) {
			heap[bp - 1] |= Alloc.This;
			heap[bp + size - 1] |= Alloc.Prev;
			return bp;
		}

		if (asize >= highSize) {
			heap[bp - 1] = (rest << 2) | Alloc.Prev;
			heap[bp + rest - 2] = rest << 2;
			this.#link(bp, rest);
			bp += rest;
			heap[bp - 1] = (asize << 2) | Alloc.This;
			heap[bp + asize - 1] |= Alloc.Prev;
			return bp;
		}

		heap[bp - 1] = (asize << 2) | Alloc.This | Alloc.Prev;
		const free = bp + asize;
		heap[free - 1] = (rest << 2) | Alloc.Prev;
		heap[free + rest - 2] = rest << 2;
		this.#link(free, rest);
		return bp;
	}

	/** Frees the block at `bp`, coalescing it with free neighbors. */
	#release(bp: number): number {
		const heap = this.heap;
		const hdr = heap[bp - 1];
		let size = hdr >>> 2;

		const next = bp + size;
		const nh = heap[next - 1];
		if (nh & Alloc.This) heap[next - 1] = nh & ~Alloc.Prev;
		else {
			const nsize = nh >>> 2;
			this.#unlink(next, nsize);
			size += nsize;
		}

		if (!(hdr & Alloc.Prev)) {
			const psize = heap[bp - 2] >>> 2;
			bp -= psize;
			this.#unlink(bp, psize);
			size += psize;
		}

		heap[bp - 1] = (size << 2) | Alloc.Prev;
		heap[bp + size - 2] = size << 2;
		this.#link(bp, size);
		return bp;
	}

	#link(bp: number, size: number): void {
		const heap = this.heap;
		const bin = binOf(size);
		const slot = this.base + headsSize + bin;
		const head = heap[slot];

		heap[bp] = 0;
		heap[bp + 1] = head;
		if (head) heap[head] = bp;
		else heap[this.base + bitmapSize + (bin >>> 5)] |= 1 << (bin & 31);
		heap[slot] = bp;
	}

	#unlink(bp: number, size: number): void {
		const heap = this.heap;
		const prev = heap[bp];
		const next = heap[bp + 1];

		if (next) heap[next] = prev;

		if (prev) {
			heap[prev + 1] = next;
			return;
		}

		const bin = binOf(size);
		heap[this.base + headsSize + bin] = next;
		if (!next) heap[this.base + bitmapSize + (bin >>> 5)] &= ~(1 << (bin & 31));
	}

	/** @returns The first non-empty bin at or after `from`, or -1. */
	#findBin(from: number): number {
		if (from >= numBins) return -1;

		const heap = this.heap;
		const bitmap = this.base + bitmapSize;
		let i = from >>> 5;
		let bits = heap[bitmap + i] & (-1 << (from & 31));

		while (!bits) {
			if (++i === bitmapWords) return -1;
			bits = heap[bitmap + i];
		}

		return (i << 5) | (31 - Math.clz32(bits & -bits));
	}

	/** Grows the heap by `want` words, or by as much as possible if at least `need`, and returns the new free block. */
	#extend(want: number, need: number): number {
		const i = this.base + Allocator.brkSize;
		const bp = this.heap[i];

		let end = bp + want;
		if (end > this.limit) {
			end = this.limit;
			if (end - bp < need) return 0;
		}

		try {
			this.#reserve(end);
		} catch {
			return 0;
		}

		const heap = this.heap;
		heap[i] = end;
		const size = end - bp;
		heap[bp - 1] = (size << 2) | Alloc.This | (heap[bp - 1] & Alloc.Prev);
		heap[end - 1] = Alloc.This | Alloc.Prev;
		return this.#release(bp);
	}

	/** Ensures `buffer` covers the words before `end`. */
	#reserve(end: number): void {
		const { buffer } = this;
		if (end <= this.heap.length) return;
		if (end * 4 > buffer.byteLength) {
			const bytes = Math.min(Math.ceil((end * 4) / growStep) * growStep, buffer.maxByteLength);
			if ('grow' in buffer) buffer.grow(bytes);
			else buffer.resize(bytes);
		}
		this.remap();
	}

	/** Recreates `heap` to cover all of `buffer`. */
	protected remap(): void {
		this.heap = new Int32Array(this.buffer, 0, Math.floor(this.buffer.byteLength / 4));
	}
}
