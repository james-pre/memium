import { Mutex } from 'memium/locks';
import { parentPort, workerData } from 'node:worker_threads';

const { buffer, iterations } = workerData;
const mutex = new Mutex(buffer, 0);
const counter = new Int32Array(buffer, 8, 1);

for (let i = 0; i < iterations; i++) {
	using _ = mutex.lock();
	const value = counter[0];
	for (let spin = 0; spin < 50; spin++);
	counter[0] = value + 1;
}

parentPort.postMessage('done');
