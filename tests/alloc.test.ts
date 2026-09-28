import assert from 'node:assert/strict';
import { once } from 'node:events';
import { suite, test } from 'node:test';
import { Worker } from 'node:worker_threads';
import { Allocator } from 'memium/alloc';
import { SharedAllocator } from 'memium/shared_alloc';
import { checkHeap, stress } from './alloc.ts';

const MiB = 1 << 20;

const buffers = {
	fixed: () => new ArrayBuffer(4 * MiB),
	resizable: () => new ArrayBuffer(0, { maxByteLength: 4 * MiB }),
	shared: () => new SharedArrayBuffer(4 * MiB),
	growable: () => new SharedArrayBuffer(0, { maxByteLength: 4 * MiB }),
};

for (const Alloc of [Allocator, SharedAllocator]) {
	suite(Alloc.name, () => {
		for (const [kind, create] of Object.entries(buffers)) {
			if (Alloc == SharedAllocator && !kind.includes('shared') && kind != 'growable') continue;

			test(`random traffic on ${kind} buffer`, () => {
				const buffer = create();
				const mem = new Alloc(buffer as any);
				stress(mem, 20_000, 0xc0ffee);
				checkHeap(buffer);
				const { total, used, free } = mem.usage();
				assert.equal(used, 0);
				assert.ok(free > 0 && free < total);
			});
		}

		test('offset heap leaves preceding bytes alone', () => {
			const buffer = new SharedArrayBuffer(MiB);
			const guard = new Uint8Array(buffer, 0, 64).fill(0xaa);
			const mem = new Alloc(buffer, 64);
			stress(mem, 5_000, 7);
			checkHeap(buffer, 64);
			assert.ok(guard.every(b => b == 0xaa));
		});

		test('rejects bad offsets and small buffers', () => {
			assert.throws(() => new Alloc(new SharedArrayBuffer(MiB), 4), RangeError);
			assert.throws(() => new Alloc(new SharedArrayBuffer(256)), RangeError);
			const junk = new SharedArrayBuffer(MiB);
			new Int32Array(junk)[0] = 12345;
			assert.throws(() => new Alloc(junk), TypeError);
		});

		test('attaches to an existing heap', () => {
			const buffer = new SharedArrayBuffer(MiB);
			const a = new Alloc(buffer);
			const ptr = a.alloc(100);
			const b = new Alloc(buffer);
			assert.deepEqual(b.usage(), a.usage());
			b.free(ptr);
			checkHeap(buffer);
			assert.equal(a.usage().used, 0);
		});
	});
}

suite('Allocator', () => {
	test('zero and invalid sizes', () => {
		const mem = new Allocator(new ArrayBuffer(MiB));
		assert.equal(mem.alloc(0), 0);
		assert.equal(mem.alloc(-1), 0);
		assert.equal(mem.alloc(NaN), 0);
		mem.free(0);
		const ptr = mem.realloc(0, 10);
		assert.notEqual(ptr, 0);
		assert.equal(mem.realloc(ptr, 0), 0);
		assert.equal(mem.usage().used, 0);
	});

	test('returns 0 when a fixed buffer is exhausted', () => {
		const buffer = new ArrayBuffer(64 * 1024);
		const mem = new Allocator(buffer);
		const ptrs = [];
		for (let ptr; (ptr = mem.alloc(1000)); ) ptrs.push(ptr);
		assert.ok(ptrs.length >= 60);
		checkHeap(buffer);
		assert.equal(mem.alloc(64 * 1024), 0);
		const last = ptrs.pop()!;
		assert.equal(mem.realloc(last, 32 * 1024), 0);
		for (const ptr of [...ptrs, last]) mem.free(ptr);
		checkHeap(buffer);
		assert.notEqual(mem.alloc(60 * 1024), 0);
	});

	test('grows a resizable buffer only as needed', () => {
		const buffer = new ArrayBuffer(0, { maxByteLength: 64 * MiB });
		const mem = new Allocator(buffer);
		assert.ok(buffer.byteLength <= 0x10000);
		const ptr = mem.alloc(MiB);
		assert.ok(buffer.byteLength >= MiB && buffer.byteLength <= MiB + 0x10000);
		assert.equal(mem.alloc(64 * MiB), 0);
		mem.free(ptr);
		checkHeap(buffer);
	});

	const filled = (buffer: ArrayBuffer, ptr: number, size: number, value: number) =>
		new Uint8Array(buffer, ptr, size).every(x => x == value);

	test('realloc into the next free block', () => {
		const buffer = new ArrayBuffer(MiB);
		const mem = new Allocator(buffer);
		mem.alloc(64);
		const b = mem.alloc(64);
		new Uint8Array(buffer, b, 64).fill(3);
		assert.equal(mem.realloc(b, 200), b);
		assert.ok(filled(buffer, b, 64, 3));
		assert.equal(mem.realloc(b, 50), b);
		checkHeap(buffer);
	});

	test('realloc past the end of the heap', () => {
		const buffer = new ArrayBuffer(MiB);
		const mem = new Allocator(buffer);
		const ptr = mem.alloc(4080);
		const total = mem.usage().total;
		new Uint8Array(buffer, ptr, 4080).fill(4);
		assert.equal(mem.realloc(ptr, 8000), ptr);
		assert.ok(filled(buffer, ptr, 4080, 4));
		assert.ok(mem.usage().total - total < 4000);
		checkHeap(buffer);
	});

	test('realloc into the previous free block', () => {
		const buffer = new ArrayBuffer(MiB);
		const mem = new Allocator(buffer);
		const x = mem.alloc(64);
		const y = mem.alloc(64);
		mem.alloc(64);
		mem.free(x);
		new Uint8Array(buffer, y, 64).fill(5);
		assert.equal(mem.realloc(y, 100), x);
		assert.ok(filled(buffer, x, 64, 5));
		checkHeap(buffer);
	});

	test('realloc that moves', () => {
		const buffer = new ArrayBuffer(MiB);
		const mem = new Allocator(buffer);
		mem.alloc(64);
		const q = mem.alloc(64);
		mem.alloc(64);
		new Uint8Array(buffer, q, 64).fill(6);
		const moved = mem.realloc(q, 1000);
		assert.notEqual(moved, q);
		assert.ok(filled(buffer, moved, 64, 6));
		checkHeap(buffer);
	});
});

suite('SharedAllocator', () => {
	test('concurrent use from workers', async () => {
		const buffer = new SharedArrayBuffer(0, { maxByteLength: 64 * MiB });
		const workers = Array.from(
			{ length: 4 },
			(_, i) =>
				new Worker(new URL('./alloc.worker.ts', import.meta.url), {
					workerData: { buffer, seed: 0x1234 * (i + 1), ops: 50_000 },
				})
		);

		await Promise.all(workers.map(w => once(w, 'message')));
		checkHeap(buffer);
		assert.equal(new SharedAllocator(buffer).usage().used, 0);
	});
});
