// Work In Progress!

import { UV } from 'kerium';
import { PagedMemory } from './pages.js';

export const defaultMemory = new PagedMemory();

export function alloc(size: number | Number): number {
	throw UV('ENOSYS', 'alloc');
}

export function free(addr: number | Number): void {
	throw UV('ENOSYS', 'free');
}

export function realloc(addr: number | Number, size: number): number {
	throw UV('ENOSYS', 'realloc');
}
