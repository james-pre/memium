import assert from 'node:assert';
import { closeSync, openSync, readSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BufferView } from 'utilium/buffer.js';
import { encodeASCII } from 'utilium/string.js';
import { field, struct, types as t } from '../src/struct.js';
import { sizeof } from '../src/misc.js';

@struct()
class Duck extends Uint8Array {
	@t.uint8 public accessor name_length: number = 0;
	@t.char(64, { countedBy: 'name_length' }) public accessor name: Uint8Array = new Uint8Array(64);
	@t.float32 public accessor age: number = 0;
	@t.float32 public accessor weight: number = 0;
	@t.float32 public accessor height: number = 0;
}

@struct()
class MamaDuck extends Duck {
	@t.uint16 public accessor n_ducklings: number = 0;

	@field(Duck, { length: 16, countedBy: 'n_ducklings' }) public accessor ducklings: Duck[] = [];
}

const duckData = new ArrayBuffer(sizeof(MamaDuck) + sizeof(Duck) * 2);

const gerald = Object.assign(new Duck(duckData, sizeof(MamaDuck)), {
	name_length: 6,
	name: encodeASCII('Gerald'),
	age: 1,
	weight: 2,
	height: 3,
});

assert.equal(gerald.name.byteLength, 6);

const donald = Object.assign(new Duck(duckData, sizeof(MamaDuck) + sizeof(Duck)), {
	name_length: 6,
	name: encodeASCII('Donald'),
	age: 2,
	weight: 30,
	height: 4,
});

const mama = Object.assign(new MamaDuck(duckData, 0, duckData.byteLength), {
	name_length: 4,
	name: encodeASCII('Mama'),
	age: 9.6,
	weight: 12,
	height: 9,
	ducklings: [gerald, donald],
	n_ducklings: 2,
});

const mom = new MamaDuck(duckData, 0, duckData.byteLength);

assert.deepEqual(mom, mama);

writeFileSync(join(import.meta.dirname, '../tmp/ducks.bin'), new Uint8Array(duckData));

const mom2data = new Uint8Array(duckData.byteLength);

const fd = openSync(join(import.meta.dirname, '../tmp/ducks.bin'), 'r');
readSync(fd, mom2data, 0, mom2data.length, 0);
closeSync(fd);

const mom2 = new MamaDuck(mom2data.buffer, 0, mom2data.byteLength);

assert.deepEqual(mom2, mama);
