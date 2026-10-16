import { EpochTable, Mutex } from 'memium/locks';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { suite, test } from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';
import { Worker } from 'node:worker_threads';

suite('Mutex', () => {
	test('excludes other threads', async () => {
		const buffer = new SharedArrayBuffer(16);
		const iterations = 2000;
		const workers = Array.from(
			{ length: 4 },
			() => new Worker(import.meta.dirname + '/locks.worker.js', { workerData: { buffer, iterations } })
		);
		await Promise.all(workers.map(worker => once(worker, 'message')));
		await Promise.all(workers.map(worker => worker.terminate()));
		assert.equal(new Int32Array(buffer, 8, 1)[0], 4 * iterations);
	});

	test('reports re-entrance on unshared memory instead of waiting', () => {
		const mutex = new Mutex(new ArrayBuffer(8), 0);
		using _ = mutex.lock();
		assert.throws(() => mutex.lock(), { code: 'EDEADLK' });
		assert.equal(mutex.tryLock(), undefined);
	});

	test('can be acquired again after release', () => {
		const mutex = new Mutex(new ArrayBuffer(8), 0);
		mutex.lock()();
		assert.equal(mutex.isLocked, false);
		using _ = mutex.lock();
		assert.equal(mutex.isLocked, true);
	});

	test('takes over expired leases', async () => {
		const buffer = new SharedArrayBuffer(8);
		const abandoned = new Mutex(buffer, 0, { lease: 20 }).lock();
		const mutex = new Mutex(buffer, 0, { lease: 1000, timeout: 1000 });

		const start = Date.now();
		const guard = mutex.lock();
		assert.ok(Date.now() - start >= 15, 'lock was taken before the lease expired');

		assert.equal(abandoned.renew(), false);
		abandoned();
		assert.equal(mutex.isLocked, true, 'a stale release must not unlock the new holder');
		assert.equal(guard.renew(), true);
		guard();
		await sleep(0);
	});

	test('times out', () => {
		const buffer = new SharedArrayBuffer(8);
		using _ = new Mutex(buffer, 0).lock();
		assert.throws(() => new Mutex(buffer, 0, { timeout: 20 }).lock(), { code: 'EBUSY' });
	});

	test('rejects unaligned memory', () => {
		assert.throws(() => new Mutex(new ArrayBuffer(16), 4), { code: 'EINVAL' });
	});
});

suite('EpochTable', () => {
	test('tracks the oldest pinned epoch', () => {
		const table = new EpochTable(new ArrayBuffer(EpochTable.sizeOf(4)), 0, 4);
		assert.equal(table.oldest(), undefined);
		const a = table.pin(7n);
		const b = table.pin(3n);
		const c = table.pin(9n);
		assert.equal(table.oldest(), 3n);
		b();
		assert.equal(table.oldest(), 7n);
		a();
		c();
		assert.equal(table.oldest(), undefined);
	});

	test('ignores and reclaims expired slots', async () => {
		const table = new EpochTable(new ArrayBuffer(EpochTable.sizeOf(2)), 0, 2, { lease: 20, timeout: 10 });
		table.pin(1n);
		table.pin(2n);
		assert.throws(() => table.pin(3n), { code: 'EBUSY' });
		await sleep(30);
		assert.equal(table.oldest(), undefined);
		using _ = table.pin(5n);
		assert.equal(table.oldest(), 5n);
	});
});
