import { withErrno } from 'kerium';
import type { LockRelease } from 'kerium/locks';
import { crit, warn } from 'kerium/log';

const hex = (value: number): string => '0x' + value.toString(16).padStart(8, '0');

export interface LeaseOptions {
	/** How long in milliseconds a holder may keep a lock or pin before others treat it as abandoned */
	lease?: number;

	/** How long in milliseconds to wait before giving up */
	timeout?: number;
}

const defaultLease = 10_000;
const defaultTimeout = 5_000;

let canWait: boolean | undefined;

/**
 * Blocks while `array[index]` is `value`, for at most `ms` milliseconds.
 * Spins on threads that can't block.
 */
function waitWhile(array: BigInt64Array, index: number, value: bigint, ms: number): void {
	if (canWait !== false) {
		try {
			Atomics.wait(array, index, value, ms);
			canWait = true;
			return;
		} catch (e) {
			if (canWait || !(e instanceof TypeError)) throw e;
			canWait = false;
		}
	}

	const end = performance.now() + ms;
	while (Atomics.load(array, index) === value && performance.now() < end);
}

const tokenBits = 21n;
const tokenMask = (1n << tokenBits) - 1n;

/** The time a held lock's lease expires */
function deadline(held: bigint): number {
	return Number(held >> tokenBits);
}

export interface MutexGuard extends LockRelease {
	/** Extends the lease, returning false if the lock was taken over by another holder */
	renew(): boolean;
}

/**
 * A mutual exclusion lock stored in shared memory.
 * A holder that keeps the lock past its lease loses it to waiters.
 */
export class Mutex {
	/** Bytes of memory used by a mutex */
	static readonly size = 8;

	/** Required alignment of the mutex's memory */
	static readonly alignment = 8;

	protected readonly word: BigInt64Array;

	protected readonly shared: boolean;

	public readonly lease: number;

	public readonly timeout: number;

	public constructor(buffer: ArrayBufferLike, byteOffset: number, options: LeaseOptions = {}) {
		if (byteOffset % Mutex.alignment) throw withErrno('EINVAL', `Mutex at ${hex(byteOffset)} is not aligned`);
		this.word = new BigInt64Array(buffer, byteOffset, 1);
		this.shared = typeof SharedArrayBuffer != 'undefined' && buffer instanceof SharedArrayBuffer;
		this.lease = options.lease ?? defaultLease;
		this.timeout = options.timeout ?? defaultTimeout;
	}

	protected stamp(now: number): bigint {
		const token = 1n + BigInt(Math.floor(Math.random() * Number(tokenMask)));
		return (BigInt(now + this.lease) << tokenBits) | token;
	}

	/** Attempts to acquire the lock without waiting */
	public tryLock(): MutexGuard | undefined {
		const now = Date.now();
		const held = Atomics.load(this.word, 0);

		if (held && deadline(held) > now) return;

		let current = this.stamp(now);
		if (Atomics.compareExchange(this.word, 0, held, current) !== held) return;

		if (held) warn(`Mutex took over expired lock at ${hex(this.word.byteOffset)}`);

		const release = () => {
			if (!current) return;
			if (Atomics.compareExchange(this.word, 0, current, 0n) !== current)
				crit(`Mutex lock at ${hex(this.word.byteOffset)} was taken over before release`);
			current = 0n;
			Atomics.notify(this.word, 0);
		};

		const renew = (): boolean => {
			if (!current) return false;
			const next = this.stamp(Date.now());
			if (Atomics.compareExchange(this.word, 0, current, next) !== current) return false;
			current = next;
			return true;
		};

		return Object.assign(release, { renew, [Symbol.dispose]: release });
	}

	/**
	 * Acquires the lock, waiting for the current holder to release it or for its lease to expire.
	 * @throws EDEADLK if the lock is held and the memory is not shared
	 * @throws EBUSY if the lock could not be acquired before the timeout
	 */
	public lock(): MutexGuard {
		const start = Date.now();

		for (;;) {
			const guard = this.tryLock();
			if (guard) return guard;

			if (!this.shared) throw withErrno('EDEADLK', `Lock at ${hex(this.word.byteOffset)} is already held`);

			const now = Date.now();
			if (now - start >= this.timeout)
				throw withErrno('EBUSY', `Timed out waiting for lock at ${hex(this.word.byteOffset)}`);

			const held = Atomics.load(this.word, 0);
			if (!held) continue;

			const remaining = Math.min(deadline(held) - now, this.timeout - (now - start));
			if (remaining > 0) waitWhile(this.word, 0, held, remaining);
		}
	}

	/** Whether the lock is currently held by someone with an unexpired lease */
	public get isLocked(): boolean {
		const held = Atomics.load(this.word, 0);
		return !!held && deadline(held) > Date.now();
	}
}

/**
 * Epochs pinned by readers, stored in shared memory.
 * Memory retired in an epoch can be reclaimed once every pinned epoch is newer.
 * Pins whose lease has expired are treated as abandoned.
 */
export class EpochTable {
	/** Bytes of memory used by a table with `slots` slots */
	static sizeOf(slots: number): number {
		return slots * 16;
	}

	/** Required alignment of the table's memory */
	static readonly alignment = 8;

	/** Pairs of expiry times and epochs */
	protected readonly words: BigInt64Array;

	public readonly lease: number;

	public readonly timeout: number;

	public constructor(
		buffer: ArrayBufferLike,
		byteOffset: number,
		public readonly slots: number,
		options: LeaseOptions = {}
	) {
		if (byteOffset % EpochTable.alignment)
			throw withErrno('EINVAL', `Epoch table at ${hex(byteOffset)} is not aligned`);
		this.words = new BigInt64Array(buffer, byteOffset, slots * 2);
		this.lease = options.lease ?? defaultLease;
		this.timeout = options.timeout ?? defaultTimeout;
	}

	/**
	 * Pins `epoch`, reclaiming abandoned slots as needed.
	 * The caller must check that `epoch` is still current after this returns, and retry if it is not.
	 * @throws EBUSY if no slot became available before the timeout
	 */
	public pin(epoch: bigint): LockRelease {
		const start = Date.now();

		for (;;) {
			const now = Date.now();
			const expiry = BigInt(now + this.lease);

			for (let slot = 0; slot < this.slots; slot++) {
				const held = Atomics.load(this.words, slot * 2);
				if (held > now || Atomics.compareExchange(this.words, slot * 2, held, expiry) !== held) continue;

				Atomics.store(this.words, slot * 2 + 1, epoch);

				let released = false;
				const release = () => {
					if (released) return;
					released = true;
					Atomics.store(this.words, slot * 2 + 1, 0n);
					Atomics.store(this.words, slot * 2, 0n);
				};

				return Object.assign(release, { [Symbol.dispose]: release });
			}

			if (now - start >= this.timeout) throw withErrno('EBUSY', 'No epoch table slots available');
		}
	}

	/** The oldest pinned epoch, or `undefined` if none are pinned */
	public oldest(): bigint | undefined {
		const now = Date.now();
		let oldest: bigint | undefined;

		for (let slot = 0; slot < this.slots; slot++) {
			const expiry = Atomics.load(this.words, slot * 2);
			if (expiry <= now) continue;
			const epoch = Atomics.load(this.words, slot * 2 + 1);
			if (epoch && (oldest === undefined || epoch < oldest)) oldest = epoch;
		}

		return oldest;
	}
}
