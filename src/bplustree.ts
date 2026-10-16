import { withErrno } from 'kerium';
import { types } from './primitives.js';
import { isStructConstructor } from './structs.shared.js';
import type { Type, TypeOf } from './types.js';

/** Where a B+ tree keeps its nodes, each of which occupies one page */
export interface BPlusTreeStorage {
	readonly buffer: ArrayBufferLike;

	/** Size of a page in bytes */
	readonly pageSize: number;

	/** Allocates a page and returns its ID, which must not be 0 */
	alloc(): number;

	/**
	 * Releases a page the tree no longer references.
	 * Pages that existed at the last checkpoint must not be reused while older roots are in use.
	 */
	free(page: number): void;

	/** Byte offset of a page within `buffer` */
	offsetOf(page: number): number;
}

export interface BPlusTreeOptions<K, V> {
	key: TypeOf<K>;
	value: TypeOf<V>;

	/** Orders keys. Defaults to comparing with `<` and `>`. */
	compare?(this: void, a: K, b: K): number;
}

function defaultCompare<K>(a: K, b: K): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

const enum Kind {
	Branch = 0,
	Leaf = 1,
}

/**
 * Node layout:
 * - u8 kind
 * - u8 reserved
 * - u16 count
 * - u32 reserved
 * - keys
 * - values (leaves) or child page IDs (branches)
 */
const headerSize = 8;

const childSize = types.uint32.size;

/** Pages and indexes from the root to the current entry */
type Cursor = [page: number, index: number][];

/** The node created by splitting another and the key that separates them */
interface Split<K> {
	key: K;
	page: number;
}

/**
 * A copy-on-write B+ tree in linear memory with the same interface as `Map`.
 * Changes copy pages that existed at the last checkpoint along with every page above them,
 * so roots from before a checkpoint remain valid snapshots.
 * Iterating while modifying the tree is not supported.
 */
export class BPlusTree<K, V> implements Map<K, V> {
	public readonly [Symbol.toStringTag] = 'B+Tree';

	protected readonly u8: Uint8Array;
	protected readonly view: DataView;

	protected readonly keyType: Type<K>;
	protected readonly valueType: Type<V>;
	protected readonly keySize: number;
	protected readonly valueSize: number;
	protected readonly leafCapacity: number;
	protected readonly branchCapacity: number;
	protected readonly compare: (a: K, b: K) => number;

	/** Whether keys and values must be copied before being returned */
	protected readonly detachKeys: boolean;
	protected readonly detachValues: boolean;

	/** Pages allocated since the last checkpoint, which can be modified in place */
	protected readonly fresh = new Set<number>();

	protected readonly keyScratch: Uint8Array;
	protected readonly valueScratch: Uint8Array;

	public constructor(
		public readonly storage: BPlusTreeStorage,
		options: BPlusTreeOptions<K, V>,
		protected _root: number = 0,
		protected _size: number = 0
	) {
		const { buffer, pageSize } = storage;
		this.u8 = new Uint8Array(buffer);
		this.view = new DataView(buffer);
		this.keyType = options.key as Type<K>;
		this.valueType = options.value as Type<V>;
		this.keySize = options.key.size;
		this.valueSize = options.value.size;
		this.leafCapacity = Math.floor((pageSize - headerSize) / (this.keySize + this.valueSize));
		this.branchCapacity = Math.floor((pageSize - headerSize - childSize) / (this.keySize + childSize));
		this.compare = options.compare ?? defaultCompare;
		this.detachKeys = isStructConstructor(options.key);
		this.detachValues = isStructConstructor(options.value);
		this.keyScratch = new Uint8Array(this.keySize);
		this.valueScratch = new Uint8Array(this.valueSize);

		if (this.leafCapacity < 4 || this.branchCapacity < 4)
			throw withErrno('EINVAL', 'Page size is too small for B+ tree keys and values');
	}

	/** The page ID of the root, or 0 if the tree is empty */
	public get root(): number {
		return this._root;
	}

	public get size(): number {
		return this._size;
	}

	/** Number of levels in the tree */
	public get height(): number {
		let height = 0;
		for (let page = this._root; page; page = this.isLeaf(page) ? 0 : this.child(page, 0)) height++;
		return height;
	}

	/** Makes every current page immutable, so later changes copy them */
	public checkpoint(): void {
		this.fresh.clear();
	}

	/** Switches to a different root and size */
	public reset(root: number, size: number): void {
		this._root = root;
		this._size = size;
		this.fresh.clear();
	}

	// Node access

	protected base(page: number): number {
		return this.storage.offsetOf(page);
	}

	protected isLeaf(page: number): boolean {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-enum-comparison
		return this.u8[this.base(page)] === Kind.Leaf;
	}

	protected count(page: number): number {
		return this.view.getUint16(this.base(page) + 2, true);
	}

	protected setCount(page: number, count: number): void {
		this.view.setUint16(this.base(page) + 2, count, true);
	}

	protected capacity(page: number): number {
		return this.isLeaf(page) ? this.leafCapacity : this.branchCapacity;
	}

	protected keyOffset(page: number, index: number): number {
		return this.base(page) + headerSize + index * this.keySize;
	}

	protected valueOffset(page: number, index: number): number {
		return this.base(page) + headerSize + this.leafCapacity * this.keySize + index * this.valueSize;
	}

	protected childOffset(page: number, index: number): number {
		return this.base(page) + headerSize + this.branchCapacity * this.keySize + index * childSize;
	}

	protected decode<T>(type: Type<T>, offset: number, detach: boolean): T {
		const { buffer } = this.storage;
		return detach ? type.get(buffer.slice(offset, offset + type.size), 0) : type.get(buffer, offset);
	}

	/** A key, which is a view of the page unless `detach` is set */
	protected key(page: number, index: number, detach: boolean = false): K {
		return this.decode(this.keyType, this.keyOffset(page, index), detach && this.detachKeys);
	}

	protected value(page: number, index: number): V {
		return this.decode(this.valueType, this.valueOffset(page, index), this.detachValues);
	}

	protected entry(page: number, index: number): [K, V] {
		return [this.key(page, index, true), this.value(page, index)];
	}

	protected child(page: number, index: number): number {
		return this.view.getUint32(this.childOffset(page, index), true);
	}

	protected setChild(page: number, index: number, child: number): void {
		this.view.setUint32(this.childOffset(page, index), child, true);
	}

	/**
	 * Index of the first key not less than `key`, or greater than `key` if `upper` is set.
	 * In branches, the upper bound is the index of the child that would contain `key`.
	 */
	protected bound(page: number, key: K, upper: boolean): number {
		let lo = 0,
			hi = this.count(page);
		while (lo < hi) {
			const mid = (lo + hi) >>> 1;
			const order = this.compare(this.key(page, mid), key);
			if (order < 0 || (upper && order === 0)) lo = mid + 1;
			else hi = mid;
		}
		return lo;
	}

	// Page management

	protected createNode(kind: Kind): number {
		const page = this.storage.alloc();
		this.fresh.add(page);
		const base = this.base(page);
		this.u8.fill(0, base, base + headerSize);
		this.u8[base] = kind;
		return page;
	}

	/** Returns a page that can be modified in place, copying `page` if it is not fresh */
	protected writable(page: number): number {
		if (this.fresh.has(page)) return page;
		const copy = this.storage.alloc();
		this.fresh.add(copy);
		const from = this.base(page);
		this.u8.copyWithin(this.base(copy), from, from + this.storage.pageSize);
		this.storage.free(page);
		return copy;
	}

	protected release(page: number): void {
		this.fresh.delete(page);
		this.storage.free(page);
	}

	/** Moves `count` keys, along with values for leaves, within or between nodes of the same kind */
	protected moveEntries(from: number, fromIndex: number, to: number, toIndex: number, count: number): void {
		if (count <= 0) return;
		this.u8.copyWithin(
			this.keyOffset(to, toIndex),
			this.keyOffset(from, fromIndex),
			this.keyOffset(from, fromIndex + count)
		);
		if (!this.isLeaf(from)) return;
		this.u8.copyWithin(
			this.valueOffset(to, toIndex),
			this.valueOffset(from, fromIndex),
			this.valueOffset(from, fromIndex + count)
		);
	}

	protected moveChildren(from: number, fromIndex: number, to: number, toIndex: number, count: number): void {
		if (count <= 0) return;
		this.u8.copyWithin(
			this.childOffset(to, toIndex),
			this.childOffset(from, fromIndex),
			this.childOffset(from, fromIndex + count)
		);
	}

	protected copyKey(from: number, fromIndex: number, to: number, toIndex: number): void {
		this.u8.copyWithin(
			this.keyOffset(to, toIndex),
			this.keyOffset(from, fromIndex),
			this.keyOffset(from, fromIndex + 1)
		);
	}

	// Reading

	/** The leaf and index of `key`, if it is in the tree */
	protected find(key: K): [page: number, index: number] | undefined {
		let page = this._root;
		if (!page) return;
		while (!this.isLeaf(page)) page = this.child(page, this.bound(page, key, true));
		const index = this.bound(page, key, false);
		if (index < this.count(page) && this.compare(this.key(page, index), key) === 0) return [page, index];
	}

	public get(key: K): V | undefined {
		const found = this.find(key);
		return found && this.value(...found);
	}

	public has(key: K): boolean {
		return !!this.find(key);
	}

	public getOrInsert(key: K, defaultValue: V): V {
		return this.getOrInsertComputed(key, () => defaultValue);
	}

	public getOrInsertComputed(key: K, callback: (key: K) => V): V {
		const found = this.find(key);
		if (found) return this.value(...found);
		const value = callback(key);
		this.set(key, value);
		return value;
	}

	/** The first or last entry under `page` */
	protected edge(page: number, last: boolean): [K, V] {
		while (!this.isLeaf(page)) page = this.child(page, last ? this.count(page) : 0);
		return this.entry(page, last ? this.count(page) - 1 : 0);
	}

	public first(): [K, V] | undefined {
		return this._root ? this.edge(this._root, false) : undefined;
	}

	public last(): [K, V] | undefined {
		return this._root ? this.edge(this._root, true) : undefined;
	}

	/** The entry with the largest key not greater than `key` */
	public floor(key: K): [K, V] | undefined {
		let page = this._root,
			before = 0;
		if (!page) return;

		while (!this.isLeaf(page)) {
			const index = this.bound(page, key, true);
			if (index) before = this.child(page, index - 1);
			page = this.child(page, index);
		}

		const index = this.bound(page, key, true);
		if (index) return this.entry(page, index - 1);
		if (before) return this.edge(before, true);
	}

	/** The entry with the smallest key not less than `key` */
	public ceiling(key: K): [K, V] | undefined {
		let page = this._root,
			after = 0;
		if (!page) return;

		while (!this.isLeaf(page)) {
			const index = this.bound(page, key, true);
			if (index < this.count(page)) after = this.child(page, index + 1);
			page = this.child(page, index);
		}

		const index = this.bound(page, key, false);
		if (index < this.count(page)) return this.entry(page, index);
		if (after) return this.edge(after, false);
	}

	/** Moves a cursor that is past the end of its leaf to the next entry, emptying it at the end of the tree */
	protected settle(cursor: Cursor): void {
		if (!cursor.length || cursor.at(-1)![1] < this.count(cursor.at(-1)![0])) return;

		do cursor.pop();
		while (cursor.length && cursor.at(-1)![1] >= this.count(cursor.at(-1)![0]));

		if (!cursor.length) return;

		const frame = cursor.at(-1)!;
		frame[1]++;
		for (let page = this.child(...frame); ; page = this.child(page, 0)) {
			cursor.push([page, 0]);
			if (this.isLeaf(page)) return;
		}
	}

	/** Entries with keys in `[start, end)`, in order */
	public *entries(start?: K, end?: K): MapIterator<[K, V]> {
		const cursor: Cursor = [];
		for (let page = this._root; page; ) {
			const leaf = this.isLeaf(page);
			const index = start === undefined ? 0 : this.bound(page, start, !leaf);
			cursor.push([page, index]);
			page = leaf ? 0 : this.child(page, index);
		}

		this.settle(cursor);
		while (cursor.length) {
			const frame = cursor.at(-1)!;
			const entry = this.entry(...frame);
			if (end !== undefined && this.compare(entry[0], end) >= 0) return;
			yield entry;
			frame[1]++;
			this.settle(cursor);
		}
	}

	public *keys(): MapIterator<K> {
		for (const [key] of this.entries()) yield key;
	}

	public *values(): MapIterator<V> {
		for (const [, value] of this.entries()) yield value;
	}

	public [Symbol.iterator](): MapIterator<[K, V]> {
		return this.entries();
	}

	public forEach(callback: (value: V, key: K, map: Map<K, V>) => void, thisArg?: any): void {
		for (const [key, value] of this.entries()) callback.call(thisArg, value, key, this);
	}

	// Insertion

	/** Encodes the separator key and new page of a split, for inserting into a branch */
	protected encode(split: Split<K>): [key: Uint8Array, child: Uint8Array] {
		this.keyType.set(this.keyScratch.buffer, 0, split.key);
		const child = new Uint8Array(childSize);
		types.uint32.set(child.buffer, 0, split.page);
		return [this.keyScratch, child];
	}

	/** Inserts a key at `index` of a node with room, along with a value for leaves or the child after the key for branches */
	protected place(page: number, index: number, key: Uint8Array, item: Uint8Array): void {
		const count = this.count(page);
		this.moveEntries(page, index, page, index + 1, count - index);
		this.u8.set(key, this.keyOffset(page, index));

		if (this.isLeaf(page)) this.u8.set(item, this.valueOffset(page, index));
		else {
			this.moveChildren(page, index + 1, page, index + 2, count - index);
			this.u8.set(item, this.childOffset(page, index + 1));
		}

		this.setCount(page, count + 1);
	}

	/** Copies `count` items of `size` bytes starting at `offset`, with `item` inserted at `index` */
	protected spliced(offset: number, count: number, size: number, index: number, item: Uint8Array): Uint8Array {
		const result = new Uint8Array((count + 1) * size);
		result.set(this.u8.subarray(offset, offset + index * size), 0);
		result.set(item, index * size);
		result.set(this.u8.subarray(offset + index * size, offset + count * size), (index + 1) * size);
		return result;
	}

	/**
	 * Splits a full node while placing a key and item at `index`.
	 * Leaves keep the separator key, and branches move it up.
	 */
	protected split(page: number, index: number, key: Uint8Array, item: Uint8Array): Split<K> {
		const leaf = this.isLeaf(page);
		const capacity = this.capacity(page);
		const [itemOffset, itemSize] = leaf
			? [(node: number) => this.valueOffset(node, 0), this.valueSize]
			: [(node: number) => this.childOffset(node, 0), childSize];

		const keys = this.spliced(this.keyOffset(page, 0), capacity, this.keySize, index, key);
		const items = leaf
			? this.spliced(itemOffset(page), capacity, itemSize, index, item)
			: this.spliced(itemOffset(page), capacity + 1, itemSize, index + 1, item);

		const total = capacity + 1;
		const left = leaf ? Math.ceil(total / 2) : Math.floor(total / 2);
		const rightStart = leaf ? left : left + 1;
		const right = this.createNode(leaf ? Kind.Leaf : Kind.Branch);

		this.u8.set(keys.subarray(0, left * this.keySize), this.keyOffset(page, 0));
		this.u8.set(items.subarray(0, rightStart * itemSize), itemOffset(page));
		this.setCount(page, left);

		this.u8.set(keys.subarray(rightStart * this.keySize), this.keyOffset(right, 0));
		this.u8.set(items.subarray(rightStart * itemSize), itemOffset(right));
		this.setCount(right, total - rightStart);

		return { key: this.keyType.get(keys.buffer, left * this.keySize), page: right };
	}

	public set(key: K, value: V): this {
		this.keyType.set(this.keyScratch.buffer, 0, key);
		this.valueType.set(this.valueScratch.buffer, 0, value);

		if (!this._root) {
			this._root = this.createNode(Kind.Leaf);
			this.place(this._root, 0, this.keyScratch, this.valueScratch);
			this._size++;
			return this;
		}

		const [root, split] = this.insert(this._root, key, this.keyScratch, this.valueScratch);
		this._root = root;
		if (!split) return this;

		this._root = this.createNode(Kind.Branch);
		this.setChild(this._root, 0, root);
		this.place(this._root, 0, ...this.encode(split));
		return this;
	}

	/** Inserts into the subtree at `page`, returning its new page ID and how it split, if it did */
	protected insert(page: number, key: K, keyBytes: Uint8Array, value: Uint8Array): [page: number, split?: Split<K>] {
		let index: number, item: Uint8Array;

		if (this.isLeaf(page)) {
			index = this.bound(page, key, false);
			page = this.writable(page);

			if (index < this.count(page) && this.compare(this.key(page, index), key) === 0) {
				this.u8.set(value, this.valueOffset(page, index));
				return [page];
			}

			this._size++;
			item = value;
		} else {
			index = this.bound(page, key, true);
			const child = this.child(page, index);
			const [updated, split] = this.insert(child, key, keyBytes, value);
			if (updated === child && !split) return [page];

			page = this.writable(page);
			this.setChild(page, index, updated);
			if (!split) return [page];

			[keyBytes, item] = this.encode(split);
		}

		if (this.count(page) < this.capacity(page)) {
			this.place(page, index, keyBytes, item);
			return [page];
		}

		return [page, this.split(page, index, keyBytes, item)];
	}

	// Deletion

	public delete(key: K): boolean {
		if (!this._root) return false;

		const root = this.remove(this._root, key);
		if (root === undefined) return false;

		this._size--;

		if (this.count(root)) this._root = root;
		else if (this.isLeaf(root)) {
			this.release(root);
			this._root = 0;
		} else {
			this._root = this.child(root, 0);
			this.release(root);
		}

		return true;
	}

	/** Removes `key` from the subtree at `page`, returning its new page ID or `undefined` if the key was not found */
	protected remove(page: number, key: K): number | undefined {
		if (this.isLeaf(page)) {
			const index = this.bound(page, key, false);
			const count = this.count(page);
			if (index >= count || this.compare(this.key(page, index), key) !== 0) return;

			page = this.writable(page);
			this.moveEntries(page, index + 1, page, index, count - index - 1);
			this.setCount(page, count - 1);
			return page;
		}

		const index = this.bound(page, key, true);
		const child = this.remove(this.child(page, index), key);
		if (child === undefined) return;

		page = this.writable(page);
		this.setChild(page, index, child);

		if (this.count(child) < Math.floor(this.capacity(child) / 2)) this.rebalance(page, index);

		return page;
	}

	/** Fixes an underfull child at `index` of `parent` by borrowing from or merging with a sibling */
	protected rebalance(parent: number, index: number): void {
		const separator = index > 0 ? index - 1 : index;
		const left = this.writable(this.child(parent, separator));
		const right = this.writable(this.child(parent, separator + 1));
		this.setChild(parent, separator, left);
		this.setChild(parent, separator + 1, right);

		const leaf = this.isLeaf(left);
		const leftCount = this.count(left),
			rightCount = this.count(right);

		// Merging branches also brings down the separator
		const gap = leaf ? 0 : 1;

		if (leftCount + gap + rightCount <= this.capacity(left)) {
			if (!leaf) this.copyKey(parent, separator, left, leftCount);
			this.moveEntries(right, 0, left, leftCount + gap, rightCount);
			if (!leaf) this.moveChildren(right, 0, left, leftCount + 1, rightCount + 1);
			this.setCount(left, leftCount + gap + rightCount);

			const parentCount = this.count(parent);
			this.moveEntries(parent, separator + 1, parent, separator, parentCount - separator - 1);
			this.moveChildren(parent, separator + 2, parent, separator + 1, parentCount - separator - 1);
			this.setCount(parent, parentCount - 1);

			this.release(right);
			return;
		}

		if (leaf && index == separator) {
			this.moveEntries(right, 0, left, leftCount, 1);
			this.moveEntries(right, 1, right, 0, rightCount - 1);
		} else if (leaf) {
			this.moveEntries(right, 0, right, 1, rightCount);
			this.moveEntries(left, leftCount - 1, right, 0, 1);
		} else if (index == separator) {
			this.copyKey(parent, separator, left, leftCount);
			this.setChild(left, leftCount + 1, this.child(right, 0));
			this.copyKey(right, 0, parent, separator);
			this.moveEntries(right, 1, right, 0, rightCount - 1);
			this.moveChildren(right, 1, right, 0, rightCount);
		} else {
			this.moveEntries(right, 0, right, 1, rightCount);
			this.moveChildren(right, 0, right, 1, rightCount + 1);
			this.copyKey(parent, separator, right, 0);
			this.setChild(right, 0, this.child(left, leftCount));
			this.copyKey(left, leftCount - 1, parent, separator);
		}

		const moved = index == separator ? 1 : -1;
		this.setCount(left, leftCount + moved);
		this.setCount(right, rightCount - moved);

		if (leaf) this.copyKey(right, 0, parent, separator);
	}

	public clear(): void {
		for (const page of Array.from(this.pages())) this.release(page);
		this._root = 0;
		this._size = 0;
	}

	/** Every page currently used by the tree */
	public *pages(): Generator<number> {
		const pages = [this._root];
		while (pages.length) {
			const page = pages.pop()!;
			if (!page) continue;
			yield page;
			if (!this.isLeaf(page)) for (let i = 0; i <= this.count(page); i++) pages.push(this.child(page, i));
		}
	}
}
