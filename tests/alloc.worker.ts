import { parentPort, workerData } from 'node:worker_threads';
import { SharedAllocator } from 'memium/shared_alloc';
import { stress } from './alloc.ts';

const { buffer, seed, ops } = workerData as { buffer: SharedArrayBuffer; seed: number; ops: number };

stress(new SharedAllocator(buffer), ops, seed);

parentPort!.postMessage('done');
