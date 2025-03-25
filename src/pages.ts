// Work In Progress!

export interface Page {
	buffer: ArrayBufferLike;
	offset: number;
}

export class PagedMemory {
	/** "physical" memory */
	readonly raw: ArrayBufferLike[] = [];

	readonly pages = new Map<number, Page>();

	constructor(readonly pageSize: number = 0x1000) {}

	/**
	 * @param address logical
	 */
	add(address: number, size: number): void {
		const start = Math.floor(address / this.pageSize);
		const end = start + Math.ceil(size / this.pageSize);

		for (let i = start; i < end; i++) {
			const page = this.pages.get(i);
			if (page) continue;
			// otherwise allocate page
		}
	}

	/**
	 * @param address logical
	 */
	at(address: number): Uint8Array {
		const page = this.pages.get(Math.floor(address / this.pageSize));
		if (!page) throw new Error('PAGE_FAULT');

		const pageOffset = address % this.pageSize;
		return new Uint8Array(page.buffer, page.offset + pageOffset, this.pageSize - pageOffset);
	}
}
