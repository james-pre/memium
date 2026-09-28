import { withErrno } from 'kerium';
import type { LockRelease } from 'kerium/locks';
import { crit } from 'kerium/log';

const hex = (value: number | bigint): string => '0x' + value.toString(16).padStart(8, '0');

/** Number of times to attempt to acquire a lock before giving up. */
const maxLockAttempts = 5;

/** Wait for the block to be unlocked. */
function waitUnlocked(data: Int32Array, lockIndex: number, depth: number = 0): void {
	if (depth > maxLockAttempts)
		throw crit(withErrno('EBUSY', `exceeded max attempts waiting for ${hex(data.byteOffset)} to be unlocked`));

	if (!Atomics.load(data, lockIndex)) return;
	switch (Atomics.wait(data, lockIndex, 1)) {
		case 'ok':
			break;
		case 'not-equal':
			depth++;
			return waitUnlocked(data, lockIndex, depth);
		case 'timed-out':
			throw crit(withErrno('EBUSY', `timed out waiting for ${hex(data.byteOffset)} to be unlocked`));
	}
}

function lock(data: Int32Array, lockIndex: number): LockRelease {
	waitUnlocked(data, lockIndex);

	Atomics.store(data, lockIndex, 1);

	const release = () => {
		Atomics.store(data, lockIndex, 0);
		Atomics.notify(data, lockIndex, 1);
	};

	release[Symbol.dispose] = release;

	return release;
}
