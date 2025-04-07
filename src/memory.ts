/* eslint-disable @typescript-eslint/no-array-delete, @typescript-eslint/no-for-in-array */
// Work In Progress!

import { UV } from 'kerium';
import type { Tuple } from 'utilium';
import { BufferView, initView } from 'utilium/buffer.js';
import { sizeof } from './misc.js';
import { Pointer } from './pointer.js';
import { field, packed, struct, types as t } from './struct.js';
import { Void, type Type } from './types.js';

export interface MemoryUsage {
	total: number;
	used: number;
	free: number;
}

/**
 * A generic memory allocator interface.
 */
export interface Memory<T extends ArrayBufferLike, U extends MemoryUsage = MemoryUsage> extends ArrayBufferView<T> {
	/**
	 * The total size in bytes of this memory.
	 */
	readonly size: number;

	/**
	 * Returns the usage of this memory.
	 */
	usage(): U;

	/**
	 * Allocates `size` bytes of memory.
	 */
	alloc(size: number): Pointer<any>;

	/**
	 * Frees a section of memory.
	 */
	free(addr: number | Pointer<any>): void;

	/**
	 * Reallocates a section of memory.
	 */
	realloc<T extends Type = Void>(addr: number | Pointer<T>, size: number): Pointer<T>;

	/**
	 * Useful for memory that supports multiple buffers.
	 * This returns the buffer, offset in the buffer, and remaining length at a given address.
	 */
	at(addr: number): ArrayBufferView<T>;
}

/**
 * Keeps track of the last `Memory` instance created.
 * This is used as defaults for various interfaces.
 * @internal
 */
export let _lastMemory: Memory<any> | undefined;

export interface Section {
	size: number;
	isFree: boolean;
}

/**
 * A memory manager that works with a single array buffer.
 * It is not designed for use-cases involving multiple realms or serialization.
 */
export class ArrayBufferMemory<T extends ArrayBufferLike> implements Memory<T> {
	declare public readonly buffer: T;
	declare public readonly byteOffset: number;
	declare public readonly byteLength: number;

	public get size(): number {
		return this.byteLength;
	}

	/**
	 * A map of offsets to sections.
	 * Spare arrays are used for auto-sort and other "magic".
	 */
	protected map: Section[] = [];

	public constructor(
		buffer?: T | ArrayBufferView<T> | ArrayLike<number> | number,
		byteOffset?: number,
		byteLength?: number
	) {
		initView<T>(this, buffer, byteOffset, byteLength);
		this.map.push({ size: this.byteLength, isFree: true });
		_lastMemory = this;
	}

	/**
	 * Collects all free sections that are adjacent to the section at the given address.
	 *
	 * @remarks
	 * This function assumes the provided section exists in the map.
	 */
	protected collectFreeSections(at: number | Pointer<any>): void {
		const sections: [number, Section][] = Object.entries(this.map).map(([k, s]) => [Number(k), s]);

		const i = sections.findIndex(([off]) => off === at);
		if (i === -1) throw UV('EINVAL');

		let primary = sections[i];

		// "left" side
		for (const [off, section] of sections.slice(0, i).reverse()) {
			if (!section.isFree) break;

			section.size += primary[1].size;
			delete this.map[primary[0]];
			primary = [off, section];
		}

		// "right" side
		for (const [off, section] of sections.slice(i + 1)) {
			if (!section.isFree) break;

			primary[1].size += section.size;
			delete this.map[off];
		}
	}

	public alloc(size: number): Pointer<Void> {
		if (size > this.byteLength) throw UV('ENOMEM', 'alloc');

		for (const key in this.map) {
			const off = Number(key);
			const { size: sectionSize, isFree } = this.map[off];
			if (!isFree || sectionSize < size) continue;

			this.map[off + size] = { size: sectionSize - size, isFree: true };
			this.map[off] = { size, isFree: false };

			return new Pointer(Void, off, this);
		}

		throw UV('ENOMEM', 'alloc');
	}

	public free(addr: number | Pointer<any>): void {
		addr = addr.valueOf();
		if (!(addr in this.map)) throw UV('EINVAL', 'free');

		this.map[addr].isFree = true;
		queueMicrotask(() => this.collectFreeSections(addr));
	}

	public realloc<T extends Type = Void>(at: number | Pointer<T>, size: number): Pointer<T> {
		const pointer = at instanceof Pointer ? at : (new Pointer(Void, at, this) as Pointer<any>);
		const addr = at instanceof Pointer ? pointer.valueOf() : at;
		if (addr > this.byteLength) throw UV('EFAULT');
		if (size > this.byteLength) throw UV('ENOMEM');
		if (!(addr in this.map)) throw UV('EINVAL', 'realloc');

		queueMicrotask(() => this.collectFreeSections(addr));

		const off = Number(addr);
		const oldSize = this.map[off].size;

		if (oldSize >= size) {
			this.map[off].size = size;
			this.map[off + size] = { size: oldSize - size, isFree: true };
			return pointer;
		}

		let needsMove = false;
		const free = [];

		for (const key in this.map) {
			const off = Number(key);
			if (off <= addr + oldSize && off >= addr + size) continue;

			if (this.map[off].isFree) free.push(off);
			else needsMove = true;
		}

		if (!needsMove) {
			for (const off of free) delete this.map[off];
			this.map[addr].size = size;
			return pointer;
		}

		const view = new Uint8Array(this.buffer);
		const newPointer = new Pointer(pointer.type, this.alloc(size).valueOf(), this);

		view.copyWithin(newPointer.valueOf(), addr, addr + oldSize);
		this.map[addr].isFree = true;
		return newPointer;
	}

	public usage(): MemoryUsage {
		let used = 0,
			free = 0;

		for (const key in this.map) {
			const off = Number(key);
			const { size, isFree } = this.map[off];
			if (isFree) free += size;
			else used += size;
		}

		return { total: this.byteLength, used, free };
	}

	public at(addr: number): Uint8Array<T> {
		if (addr > this.byteLength) throw UV('EFAULT');
		return new Uint8Array(this.buffer, addr, this.byteLength);
	}
}

/**
 * @experimental
 */
const enum Flags {
	_None = 1 << 0,
	Black = 1 << 1, // For red-black tree coloring
	Allocated = 1 << 2,

	// unused for now
	Readable = 1 << 3,
	Writable = 1 << 4,
	Executable = 1 << 5,
}

/**
 * A header for sections of `SharableMemory`
 * @experimental
 */
@struct(packed)
class SharableSection<T extends ArrayBufferLike = ArrayBufferLike> extends BufferView<T> {
	declare static readonly size: number;
	declare static get: (buffer: ArrayBufferLike, offset: number) => SharableSection;
	declare static set: (buffer: ArrayBufferLike, offset: number, value: SharableSection) => void;

	@t.uint8 accessor flags!: number;
	@t.uint8(3) accessor _padding!: Tuple<number, 3>;
	@t.uint32 accessor size!: number;
	@field(Pointer) accessor left!: Pointer;
	@field(Pointer) accessor right!: Pointer;
}

/**
 * @experimental
 */
interface SharableUsage extends MemoryUsage {
	metadata: number;
}

/**
 * A more robust memory manager that is multi-threading safe.
 * @experimental
 */
export class SharableMemory<T extends ArrayBufferLike> implements Memory<T, SharableUsage> {
	declare public readonly buffer: T;
	declare public readonly byteOffset: number;
	declare public readonly byteLength: number;

	public get size(): number {
		return this.byteLength;
	}

	protected root: SharableSection;

	public constructor(
		buffer?: T | ArrayBufferView<T> | ArrayLike<number> | number,
		byteOffset?: number,
		byteLength?: number
	) {
		initView<T>(this, buffer, byteOffset, byteLength);
		_lastMemory = this;
		const root = new SharableSection(this.buffer, 0);
		if (!root.left && !root.right) root.size ||= this.byteLength - sizeof(SharableSection);
		this.root = root;
	}

	protected *map(n: number | Pointer<typeof SharableSection> = 0): Iterable<[number, SharableSection]> {
		const section = new SharableSection(this.buffer, n.valueOf());
		if (section.left) yield* this.map(section.left.as(SharableSection));
		yield [n.valueOf(), section];
		if (section.right) yield* this.map(section.right.as(SharableSection));
	}

	/**
	 * Collects all free sections that are adjacent to the section at the given address.
	 *
	 * @remarks
	 * This function assumes the provided section exists in the map.
	 */
	protected collectFreeSections(at: number | Pointer<any>): void {
		const sections: [number, SharableSection][] = Object.entries(this.map).map(([k, s]) => [Number(k), s]);

		const i = sections.findIndex(([off]) => off === at);
		if (i === -1) throw UV('EINVAL');

		let primary = sections[i];

		// "left" side
		for (const [off, section] of sections.slice(0, i).reverse()) {
			if (!section.isFree) break;

			section.size += primary[1].size;
			delete this.map[primary[0]];
			primary = [off, section];
		}

		// "right" side
		for (const [off, section] of sections.slice(i + 1)) {
			if (!section.isFree) break;

			primary[1].size += section.size;
			delete this.map[off];
		}
	}

	public alloc(size: number): Pointer<Void> {
		if (size > this.byteLength) throw UV('ENOMEM', 'alloc');

		for (const [offset, section] of this.map()) {
			if (section.flags & Flags.Allocated || section.size < size) continue;

			const newSection = new SharableSection(this.buffer, offset + size);
			newSection.size = section.size - size;

			section.flags |= Flags.Allocated;
			section.size = size;

			return new Pointer(Void, offset, this);
		}

		throw UV('ENOMEM', 'alloc');
	}

	public free(addr: number | Pointer<any>): void {
		addr = addr.valueOf();
		if (!(addr in this.map)) throw UV('EINVAL', 'free');

		this.map[addr].isFree = true;
		queueMicrotask(() => this.collectFreeSections(addr));
	}

	public realloc<T extends Type = Void>(at: number | Pointer<T>, size: number): Pointer<T> {
		const pointer = at instanceof Pointer ? at : (new Pointer(Void, at, this) as Pointer<any>);
		const addr = at instanceof Pointer ? pointer.valueOf() : at;
		if (addr > this.byteLength) throw UV('EFAULT');
		if (size > this.byteLength) throw UV('ENOMEM');
		if (!(addr in this.map)) throw UV('EINVAL', 'realloc');

		queueMicrotask(() => this.collectFreeSections(addr));

		const off = Number(addr);
		const oldSize = this.map[off].size;

		if (oldSize >= size) {
			this.map[off].size = size;
			this.map[off + size] = { size: oldSize - size, isFree: true };
			return pointer;
		}

		let needsMove = false;
		const free = [];

		for (const key in this.map) {
			const off = Number(key);
			if (off <= addr + oldSize && off >= addr + size) continue;

			if (this.map[off].isFree) free.push(off);
			else needsMove = true;
		}

		if (!needsMove) {
			for (const off of free) delete this.map[off];
			this.map[addr].size = size;
			return pointer;
		}

		const view = new Uint8Array(this.buffer);
		const newPointer = new Pointer(pointer.type, this.alloc(size).valueOf(), this);

		view.copyWithin(newPointer.valueOf(), addr, addr + oldSize);
		this.map[addr].isFree = true;
		return newPointer;
	}

	public usage(): SharableUsage {
		let used = 0,
			free = 0;

		for (const key in this.map) {
			const off = Number(key);
			const { size, isFree } = this.map[off];
			if (isFree) free += size;
			else used += size;
		}

		return { total: this.byteLength, used, free };
	}

	public at(addr: number): Uint8Array<T> {
		if (addr > this.byteLength) throw UV('EFAULT');
		return new Uint8Array(this.buffer, addr, this.byteLength);
	}
}
