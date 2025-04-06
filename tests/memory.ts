import assert from 'node:assert/strict';
import { suite, test } from 'node:test';
import type { Memory } from '../src/memory.js';
import { Pointer } from '../src/pointer.js';
import { types } from '../src/primitives.js';
import { Void } from '../src/types.js';

export function testMemory(Memory: new (size: number) => Memory<ArrayBufferLike>) {
	return suite(Memory.name, () => {
		test('initialization', () => {
			const mem = new Memory(1024);

			assert.deepEqual(mem.usage(), { total: 1024, used: 0, free: 1024 });
		});

		test('allocation', () => {
			const mem = new Memory(1024);

			const size = 128;
			const pointer = mem.alloc(size);

			assert.ok(pointer instanceof Pointer);
			assert.equal(pointer.type, Void);

			assert.deepEqual(mem.usage(), { total: 1024, used: size, free: 1024 - size });
		});

		test('freeing memory', () => {
			const mem = new Memory(1024);

			const size = 128;
			const pointer = mem.alloc(size);

			mem.free(pointer);

			assert.deepEqual(mem.usage(), { total: 1024, used: 0, free: 1024 });
		});

		test('reallocation - grow', () => {
			const mem = new Memory(1024);

			const initialSize = 128;
			const pointer = mem.alloc(initialSize);

			const newSize = 256;
			const newPointer = mem.realloc(pointer, newSize);

			assert.deepEqual(mem.usage(), { total: 1024, used: newSize, free: 1024 - newSize });
		});

		test('reallocation - shrink', () => {
			const mem = new Memory(1024);

			const initialSize = 256;
			const pointer = mem.alloc(initialSize);

			const newSize = 128;
			const newPointer = mem.realloc(pointer, newSize);

			assert.equal(pointer.valueOf(), newPointer.valueOf());

			assert.deepEqual(mem.usage(), { total: 1024, used: newSize, free: 1024 - newSize });
		});

		test('at', () => {
			const mem = new Memory(1024);

			const view = mem.at(0);

			assert.ok(view instanceof Uint8Array);
			assert.equal(view.byteLength, mem.size);
			assert.equal(view.byteOffset, 0);
		});

		test('data persistence', () => {
			const mem = new Memory(1024);

			const pointer = mem.alloc(4).as(types.uint32);

			new Uint32Array(mem.buffer, pointer.valueOf(), 1)[0] = 0xbeef;

			assert.equal(pointer.deref(), 0xbeef);
		});

		test('allocation error - too large', () => {
			const mem = new Memory(128);

			assert.throws(() => mem.alloc(256), { code: 'ENOMEM' });
		});

		test('free error - invalid address', () => {
			const mem = new Memory(128);

			assert.throws(() => mem.free(999), { code: 'EINVAL' });
		});

		test('realloc error - invalid address', () => {
			const mem = new Memory(128);

			assert.throws(() => mem.realloc(999, 64), { code: 'EFAULT' });
		});

		test('multiple allocations', () => {
			const mem = new Memory(1024);

			const sizes = [64, 128, 256];
			const pointers = sizes.map(size => mem.alloc(size));

			const usage = mem.usage();
			assert.equal(
				usage.used,
				sizes.reduce((a, b) => a + b, 0)
			);

			// Free middle allocation
			mem.free(pointers[1]);

			const usageAfterFree = mem.usage();
			const used = sizes[0] + sizes[2];
			assert.equal(usageAfterFree.used, used);
			assert.equal(usageAfterFree.free, 1024 - used);
		});

		test('at error - out of bounds', () => {
			const mem = new Memory(128);

			assert.throws(() => mem.at(1024), { code: 'EFAULT' });
		});
	});
}
