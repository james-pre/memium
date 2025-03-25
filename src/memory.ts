// Work In Progress!

import { ErrnoException } from 'kerium';
import { PagedMemory } from './pages.js';

export const defaultMemory = new PagedMemory();

export function alloc(size: number | Number): number {
	throw ErrnoException.With('ENOSYS', 'alloc');
}

export function free(addr: number | Number): void {
	throw ErrnoException.With('ENOSYS', 'free');
}

export function realloc(addr: number | Number, size: number): number {
	throw ErrnoException.With('ENOSYS', 'realloc');
}
