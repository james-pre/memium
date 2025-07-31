export interface FixedView<TArrayBuffer extends ArrayBufferLike = ArrayBuffer>
	extends Omit<DataView<TArrayBuffer>, `${'get' | 'set'}${string}`> {}

export interface FixedViewConstructor {
	readonly prototype: FixedView<ArrayBufferLike>;
	new <TArrayBuffer extends ArrayBufferLike & { BYTES_PER_ELEMENT?: never }>(
		buffer?: TArrayBuffer,
		byteOffset?: number,
		byteLength?: number
	): FixedView<TArrayBuffer>;
}

export function FixedView(size: number): FixedViewConstructor {
	class __view<TArrayBuffer extends ArrayBufferLike = ArrayBuffer> extends DataView<TArrayBuffer> {
		constructor(
			buffer: TArrayBuffer = new ArrayBuffer(size) as TArrayBuffer,
			byteOffset?: number,
			byteLength?: number
		) {
			super(buffer, byteOffset, byteLength ?? size);
		}
	}

	for (const key of Object.getOwnPropertyNames(DataView.prototype)) {
		if (!key.startsWith('get') && !key.startsWith('set')) continue;
		Object.defineProperty(__view.prototype, key, {
			enumerable: false,
			configurable: false,
			writable: false,
			value: undefined,
		});
	}

	return __view as FixedViewConstructor;
}
