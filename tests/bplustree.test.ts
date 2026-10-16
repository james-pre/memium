import { BPlusTree, type BPlusTreeStorage } from 'memium/bplustree';
import { types } from 'memium/primitives';
import { struct, types as t } from 'memium/structs';
import { Void, type Type } from 'memium/types';
import assert from 'node:assert/strict';
import { suite, test } from 'node:test';

class TestStorage implements BPlusTreeStorage {
	public readonly buffer: ArrayBuffer;
	protected next = 1;
	protected available: number[] = [];
	protected deferred: number[] = [];
	public readonly allocated = new Set<number>();

	public constructor(
		public readonly pageSize: number,
		pages: number
	) {
		this.buffer = new ArrayBuffer(pageSize * pages);
	}

	public alloc(): number {
		const page = this.available.pop() ?? this.next++;
		if (page * this.pageSize >= this.buffer.byteLength) throw new Error('out of pages');
		this.allocated.add(page);
		new Uint8Array(this.buffer, page * this.pageSize, this.pageSize).fill(0xcc);
		return page;
	}

	public free(page: number): void {
		if (!this.allocated.delete(page)) throw new Error(`double free of page ${page}`);
		this.deferred.push(page);
	}

	/** Makes deferred pages reusable, i.e. once no snapshot can see them */
	public reclaim(): void {
		this.available.push(...this.deferred);
		this.deferred = [];
	}

	public offsetOf(page: number): number {
		return page * this.pageSize;
	}
}

/** Verifies structural invariants, returning the depth */
function check<K, V>(tree: BPlusTree<K, V>, compare: (a: K, b: K) => number = (a, b) => (a < b ? -1 : a > b ? 1 : 0)) {
	const t = tree as any;
	let leafDepth: number | undefined;
	let count = 0;

	function visit(page: number, depth: number, low?: K, high?: K): void {
		const n = t.count(page);
		const isRoot = page === tree.root;
		const minimum = Math.floor((t.isLeaf(page) ? t.leafCapacity : t.branchCapacity) / 2);
		if (!isRoot) assert.ok(n >= minimum, `page ${page} is underfull (${n})`);
		for (let i = 0; i < n; i++) {
			const key = t.key(page, i);
			if (i) assert.ok(compare(t.key(page, i - 1), key) < 0, 'keys are not sorted');
			if (low !== undefined) assert.ok(compare(key, low) >= 0, 'key below separator');
			if (high !== undefined) assert.ok(compare(key, high) < 0, 'key above separator');
		}
		if (t.isLeaf(page)) {
			leafDepth ??= depth;
			assert.equal(depth, leafDepth, 'leaves are at different depths');
			count += n;
			return;
		}
		for (let i = 0; i <= n; i++)
			visit(t.child(page, i), depth + 1, i ? t.key(page, i - 1) : low, i < n ? t.key(page, i) : high);
	}

	if (tree.root) visit(tree.root, 1);
	assert.equal(count, tree.size, 'size does not match the number of entries');
	return leafDepth ?? 0;
}

function random(seed: number) {
	return () => {
		seed = (seed * 1103515245 + 12345) & 0x7fffffff;
		return seed;
	};
}

suite('BPlusTree', () => {
	test('matches Map under random operations', () => {
		const storage = new TestStorage(128, 4096);
		const tree = new BPlusTree(storage, { key: types.uint32, value: types.uint32 });
		const map = new Map<number, number>();
		const next = random(1);
		let maxDepth = 0;

		for (let i = 0; i < 20_000; i++) {
			const key = next() % 2000;
			if (next() % 3) {
				const value = next();
				tree.set(key, value);
				map.set(key, value);
			} else {
				assert.equal(tree.delete(key), map.delete(key));
			}

			if (i % 7 == 0) tree.checkpoint();
			if (i % 500 == 0) {
				maxDepth = Math.max(maxDepth, check(tree));
				storage.reclaim();
			}
		}

		check(tree);
		assert.ok(maxDepth >= 3, 'test did not exercise branches');
		assert.deepEqual(
			[...tree],
			[...map].sort(([a], [b]) => a - b)
		);
		assert.equal(storage.allocated.size, [...tree.pages()].length, 'pages leaked');

		for (const key of map.keys()) tree.delete(key);
		assert.equal(tree.size, 0);
		assert.equal(tree.root, 0);
		assert.equal(storage.allocated.size, 0, 'pages leaked after deleting everything');
	});

	test('sequential inserts and deletes in both directions', () => {
		for (const reverse of [false, true]) {
			const storage = new TestStorage(128, 4096);
			const tree = new BPlusTree(storage, { key: types.uint32, value: types.uint32 });
			const keys = Array.from({ length: 3000 }, (_, i) => (reverse ? 3000 - i : i));
			for (const key of keys) tree.set(key, key * 2);
			check(tree);
			assert.equal(tree.get(1500), 3000);
			for (const key of keys.slice(0, 2900)) assert.ok(tree.delete(key));
			check(tree);
			assert.equal(tree.size, 100);
			assert.equal(storage.allocated.size, [...tree.pages()].length);
		}
	});

	test('old roots remain readable after a checkpoint', () => {
		const storage = new TestStorage(128, 4096);
		const tree = new BPlusTree(storage, { key: types.uint32, value: types.uint32 });
		for (let i = 0; i < 500; i++) tree.set(i, i);
		tree.checkpoint();

		const snapshot = new BPlusTree(storage, { key: types.uint32, value: types.uint32 }, tree.root, tree.size);
		const before = [...snapshot];

		for (let i = 0; i < 500; i += 2) tree.delete(i);
		for (let i = 500; i < 1000; i++) tree.set(i, -i >>> 0);
		for (let i = 1; i < 500; i += 2) tree.set(i, 0);

		assert.deepEqual([...snapshot], before);
		check(snapshot);
		check(tree);
		assert.equal(tree.size, 750);
	});

	test('reset discards uncommitted changes', () => {
		const storage = new TestStorage(128, 4096);
		const tree = new BPlusTree(storage, { key: types.uint32, value: types.uint32 });
		for (let i = 0; i < 300; i++) tree.set(i, i);
		tree.checkpoint();
		const { root, size } = tree;

		for (let i = 0; i < 300; i++) tree.set(i, 7);
		tree.reset(root, size);

		assert.equal(tree.get(42), 42);
		check(tree);
	});

	test('floor, ceiling, and ranges of entries', () => {
		const storage = new TestStorage(128, 4096);
		const tree = new BPlusTree(storage, { key: types.uint32, value: types.uint32 });
		const keys = Array.from({ length: 600 }, (_, i) => i * 10 + 5);
		for (const key of keys) tree.set(key, key);

		assert.equal(tree.floor(4), undefined);
		assert.deepEqual(tree.floor(5), [5, 5]);
		assert.deepEqual(tree.floor(14), [5, 5]);
		assert.deepEqual(tree.floor(100_000), [5995, 5995]);
		assert.deepEqual(tree.ceiling(0), [5, 5]);
		assert.deepEqual(tree.ceiling(6), [15, 15]);
		assert.equal(tree.ceiling(5996), undefined);
		assert.deepEqual(tree.first(), [5, 5]);
		assert.deepEqual(tree.last(), [5995, 5995]);

		for (let probe = 0; probe < 6100; probe += 7) {
			const floor = keys.findLast(k => k <= probe);
			const ceiling = keys.find(k => k >= probe);
			assert.equal(tree.floor(probe)?.[0], floor, `floor(${probe})`);
			assert.equal(tree.ceiling(probe)?.[0], ceiling, `ceiling(${probe})`);
		}

		assert.deepEqual(
			[...tree.entries(1000, 1100)].map(([k]) => k),
			keys.filter(k => k >= 1000 && k < 1100)
		);
		assert.deepEqual(
			[...tree.entries(5990)].map(([k]) => k),
			[5995]
		);
	});

	test('64-bit keys without values', () => {
		const storage = new TestStorage(256, 1024);
		const tree = new BPlusTree(storage, { key: types.uint64, value: Void });
		const keys = Array.from({ length: 1000 }, (_, i) => (BigInt(i % 37) << 32n) | BigInt(i));
		for (const key of keys) tree.set(key, undefined);
		check(tree);
		assert.deepEqual(
			[...tree.keys()],
			keys.toSorted((a, b) => (a < b ? -1 : 1))
		);
		assert.ok(tree.has(keys[500]));
	});

	test('composite keys with a custom comparator', () => {
		const pair: Type<[number, number]> = {
			name: 'test.pair',
			size: 8,
			get: (buffer, offset) => [types.uint32.get(buffer, offset), types.uint32.get(buffer, offset + 4)],
			set: (buffer, offset, [a, b]) => {
				types.uint32.set(buffer, offset, a);
				types.uint32.set(buffer, offset + 4, b);
			},
		};
		const compare = (a: [number, number], b: [number, number]) => a[0] - b[0] || a[1] - b[1];
		const storage = new TestStorage(128, 1024);
		const tree = new BPlusTree(storage, { key: pair, value: types.uint8, compare });

		for (let a = 0; a < 20; a++) for (let b = 0; b < 20; b++) tree.set([19 - a, b], a);
		check(tree, compare);
		assert.equal(tree.get([3, 7]), 16);
		assert.deepEqual(tree.ceiling([4, 20])?.[0], [5, 0]);
	});

	test('struct values are copied out of pages', () => {
		const Point = struct.packed('test.Point', { x: t.uint32, y: t.uint32 });
		const point = (x: number, y: number) => Object.assign(new Point(), { x, y });

		const tree = new BPlusTree(new TestStorage(128, 64), { key: types.uint32, value: Point });
		tree.set(1, point(1, 2));
		const before = tree.get(1)!;

		tree.set(1, point(3, 4));
		assert.deepEqual([before.x, before.y], [1, 2]);
		assert.deepEqual([tree.get(1)!.x, tree.get(1)!.y], [3, 4]);
	});

	test('Map interface', () => {
		const tree = new BPlusTree(new TestStorage(128, 64), { key: types.uint32, value: types.uint32 });
		assert.equal(tree.set(1, 2), tree);
		assert.equal(tree.getOrInsert(1, 9), 2);
		assert.equal(
			tree.getOrInsertComputed(3, k => k * 2),
			6
		);
		assert.equal(tree.delete(5), false);
		const seen: [number, number][] = [];
		tree.forEach((v, k, map) => {
			assert.equal(map, tree);
			seen.push([k, v]);
		});
		assert.deepEqual(seen, [
			[1, 2],
			[3, 6],
		]);
		// eslint-disable-next-line @typescript-eslint/no-base-to-string
		assert.equal(String(tree), '[object B+Tree]');
		tree.clear();
		assert.equal(tree.size, 0);
		assert.equal(tree.get(1), undefined);
	});

	test('rejects pages too small for its keys', () => {
		assert.throws(() => new BPlusTree(new TestStorage(32, 4), { key: types.uint64, value: types.uint64 }), {
			code: 'EINVAL',
		});
	});
});
