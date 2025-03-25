// Work In Progress!

/* eslint-disable @typescript-eslint/no-wrapper-object-types */
import { PagedMemory } from './pages.js';

export const defaultMemory = new PagedMemory();

export function alloc(size: number | Number): number {
	throw new Error('Not implemented');
}

export function free(addr: number | Number): void {
	throw new Error('Not implemented');
}

export function realloc(addr: number | Number, size: number): number {
	throw new Error('Not implemented');
}
