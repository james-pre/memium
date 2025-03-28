// Work In Progress!

import { UV } from 'kerium';
import { PagedMemory } from './pages.js';
import type { Pointer } from './pointer.js';

export const defaultMemory = new PagedMemory();

export abstract class Memory {
	abstract alloc(size: number): Pointer<any>;
	abstract free(addr: number): void;
	abstract realloc(addr: number, size: number): number;
}

export function alloc(size: number | Number): number {
	throw UV('ENOSYS', 'alloc');
}

export function free(addr: number | Number): void {
	throw UV('ENOSYS', 'free');
}

export function realloc(addr: number | Number, size: number): number {
	throw UV('ENOSYS', 'realloc');
}
