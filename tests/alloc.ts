import assert from 'node:assert/strict';
import type { Allocator } from 'memium/alloc';

const ALLOC = 1;
const PREV_ALLOC = 2;
const BRK = 2;
const BITMAP = 3;
const HEADS = 8;
const NUM_BINS = 160;
const META = HEADS + NUM_BINS + 2;

function binOf(size: number): number {
	return size <= 256 ? size >>> 1 : Math.min(NUM_BINS - 1, 160 - Math.clz32(size >>> 8));
}

/** Asserts every heap invariant. */
export function checkHeap(buffer: ArrayBufferLike, byteOffset: number = 0): void {
	const h = new Int32Array(buffer);
	const base = byteOffset / 4;
	const brk = h[base + BRK];
	const free = new Set<number>();

	let prevAlloc = true;
	let bp = base + META;
	for (let size: number; (size = h[bp - 1] >>> 2); bp += size) {
		const hdr = h[bp - 1];
		assert.equal(bp % 2, 0, `block ${bp} is misaligned`);
		assert.ok(size >= 4 && size % 2 == 0, `block ${bp} has bad size ${size}`);
		assert.equal(!!(hdr & PREV_ALLOC), prevAlloc, `block ${bp} has wrong prev-alloc bit`);
		assert.ok(bp + size <= brk, `block ${bp} overruns the heap`);

		const isAlloc = !!(hdr & ALLOC);
		if (!isAlloc) {
			assert.ok(prevAlloc, `free block ${bp} follows a free block`);
			assert.equal(h[bp + size - 2] >>> 2, size, `free block ${bp} has mismatched footer`);
			free.add(bp);
		}
		prevAlloc = isAlloc;
	}

	assert.equal(bp, brk, 'epilogue is not at the break');
	assert.equal(h[bp - 1] & ALLOC, ALLOC, 'epilogue is not allocated');
	assert.equal(!!(h[bp - 1] & PREV_ALLOC), prevAlloc, 'epilogue has wrong prev-alloc bit');

	let listed = 0;
	for (let bin = 0; bin < NUM_BINS; bin++) {
		const head = h[base + HEADS + bin];
		const bit = (h[base + BITMAP + (bin >>> 5)] >>> (bin & 31)) & 1;
		assert.equal(bit, head ? 1 : 0, `bitmap bit for bin ${bin} is wrong`);

		let prev = 0;
		for (let node = head; node; prev = node, node = h[node + 1]) {
			assert.ok(free.has(node), `bin ${bin} lists non-free block ${node}`);
			assert.equal(binOf(h[node - 1] >>> 2), bin, `block ${node} is in the wrong bin`);
			assert.equal(h[node], prev, `block ${node} has a bad prev link`);
			listed++;
		}
	}
	assert.equal(listed, free.size, 'free lists do not contain every free block');
}

function fill(bytes: Uint8Array, ptr: number, size: number, seed: number): void {
	for (let i = 0; i < size; i++) bytes[ptr + i] = (seed + i * 7) & 0xff;
}

function verify(bytes: Uint8Array, ptr: number, size: number, seed: number): void {
	for (let i = 0; i < size; i++) {
		if (bytes[ptr + i] !== ((seed + i * 7) & 0xff)) assert.fail(`allocation at ${ptr} corrupted at byte ${i}`);
	}
}

/** Runs random allocation traffic, checking payload integrity along the way. */
export function stress(mem: Allocator, ops: number, seed: number, maxSize: number = 2048): void {
	const bytes = new Uint8Array(mem.buffer);
	const live = new Map<number, { ptr: number; size: number; seed: number }>();
	let rand = seed | 1;
	const random = (n: number) => {
		rand ^= rand << 13;
		rand ^= rand >>> 17;
		rand ^= rand << 5;
		return (rand >>> 0) % n;
	};

	for (let op = 0; op < ops; op++) {
		const id = random(64);
		const entry = live.get(id);
		const size = 1 + (random(4) ? random(64) : random(maxSize));

		if (!entry) {
			const ptr = mem.alloc(size);
			assert.notEqual(ptr, 0, 'out of memory');
			assert.equal(ptr % 8, 0, 'misaligned allocation');
			const s = seed + op;
			fill(bytes, ptr, size, s);
			live.set(id, { ptr, size, seed: s });
			continue;
		}

		verify(new Uint8Array(mem.buffer), entry.ptr, entry.size, entry.seed);

		if (random(2)) {
			mem.free(entry.ptr);
			live.delete(id);
			continue;
		}

		const ptr = mem.realloc(entry.ptr, size);
		assert.notEqual(ptr, 0, 'out of memory');
		assert.equal(ptr % 8, 0, 'misaligned reallocation');
		const view = new Uint8Array(mem.buffer);
		verify(view, ptr, Math.min(size, entry.size), entry.seed);
		fill(view, ptr, size, seed + op);
		live.set(id, { ptr, size, seed: seed + op });
	}

	for (const { ptr, size, seed } of live.values()) {
		verify(new Uint8Array(mem.buffer), ptr, size, seed);
		mem.free(ptr);
	}
}
