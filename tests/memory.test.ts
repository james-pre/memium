import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ArrayBufferMemory } from '../src/memory.js';
import { Pointer } from '../src/pointer.js';
import { Void } from '../src/types.js';
import { types } from '../src/primitives.js';

test('ArrayBufferMemory initialization', () => {
	const memory = new ArrayBufferMemory(1024);

	assert.deepEqual(memory.usage(), { total: 1024, used: 0, free: 1024 });
});

test('ArrayBufferMemory allocation', () => {
	const memory = new ArrayBufferMemory(1024);

	const size = 128;
	const pointer = memory.alloc(size);

	assert.ok(pointer instanceof Pointer);
	assert.equal(pointer.type, Void);

	assert.deepEqual(memory.usage(), { total: 1024, used: size, free: 1024 - size });
});

test('ArrayBufferMemory freeing memory', () => {
	const memory = new ArrayBufferMemory(1024);

	const size = 128;
	const pointer = memory.alloc(size);

	memory.free(pointer);

	assert.deepEqual(memory.usage(), { total: 1024, used: 0, free: 1024 });
});

test('ArrayBufferMemory reallocation - grow', () => {
	const memory = new ArrayBufferMemory(1024);

	const initialSize = 128;
	const pointer = memory.alloc(initialSize);

	const newSize = 256;
	const newPointer = memory.realloc(pointer, newSize);

	assert.deepEqual(memory.usage(), { total: 1024, used: newSize, free: 1024 - newSize });
});

test('ArrayBufferMemory reallocation - shrink', () => {
	const memory = new ArrayBufferMemory(1024);

	const initialSize = 256;
	const pointer = memory.alloc(initialSize);

	const newSize = 128;
	const newPointer = memory.realloc(pointer, newSize);

	assert.equal(pointer.valueOf(), newPointer.valueOf());

	assert.deepEqual(memory.usage(), { total: 1024, used: newSize, free: 1024 - newSize });
});

test('ArrayBufferMemory at', () => {
	const memory = new ArrayBufferMemory(1024);

	const view = memory.at(0);

	assert.ok(view instanceof Uint8Array);
	assert.equal(view.byteLength, memory.byteLength);
	assert.equal(view.byteOffset, 0);
});

test('ArrayBufferMemory data persistence', () => {
	const memory = new ArrayBufferMemory(1024);

	const pointer = memory.alloc(4).as(types.uint32);

	memory.at(pointer.valueOf()).set([0xef, 0xbe]);

	assert.equal(pointer.deref(), 0xbeef);
});

test('ArrayBufferMemory allocation error - too large', () => {
	const memory = new ArrayBufferMemory(128);

	assert.throws(() => memory.alloc(256), { code: 'ENOMEM' });
});

test('ArrayBufferMemory free error - invalid address', () => {
	const memory = new ArrayBufferMemory(128);

	assert.throws(() => memory.free(999), { code: 'EINVAL' });
});

test('ArrayBufferMemory realloc error - invalid address', () => {
	const memory = new ArrayBufferMemory(128);

	assert.throws(() => memory.realloc(999, 64), { code: 'EFAULT' });
});

test('ArrayBufferMemory multiple allocations', () => {
	const memory = new ArrayBufferMemory(1024);

	const sizes = [64, 128, 256];
	const pointers = sizes.map(size => memory.alloc(size));

	const usage = memory.usage();
	assert.equal(
		usage.used,
		sizes.reduce((a, b) => a + b, 0)
	);

	// Free middle allocation
	memory.free(pointers[1]);

	const usageAfterFree = memory.usage();
	const used = sizes[0] + sizes[2];
	assert.equal(usageAfterFree.used, used);
	assert.equal(usageAfterFree.free, 1024 - used);
});

test('ArrayBufferMemory at error - out of bounds', () => {
	const memory = new ArrayBufferMemory(128);

	assert.throws(() => memory.at(1024), { code: 'EFAULT' });
});
