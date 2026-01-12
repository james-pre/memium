import assert from 'node:assert';
import { closeSync, openSync, readSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeASCII } from 'utilium/string.js';
import { $from, field, struct, types as t } from '../src/decorators.js';
import { sizeof } from '../src/misc.js';

@struct.packed()
class Duck extends $from.typed(Uint8Array) {
	@t.uint8 public accessor name_length: number = 0;
	@t.char(64, { countedBy: 'name_length' }) public accessor name!: Uint8Array;
	@t.float32 public accessor age: number = 0;
	@t.float32 public accessor weight: number = 0;
	@t.float32 public accessor height: number = 0;
}

assert.equal(sizeof(Duck), 77);

@struct.packed()
class MamaDuck extends Duck {
	@t.uint16 public accessor n_ducklings: number = 0;

	@field(Duck, { countedBy: 'n_ducklings' }) public accessor ducklings: Duck[] = [];
}

const gerald = new Duck(sizeof(Duck));
gerald.name_length = 6;
gerald.name = encodeASCII('Gerald');
gerald.age = 1;
gerald.weight = 2;
gerald.height = 3;

assert.equal(gerald.name.byteLength, 6);

const donald = new Duck(sizeof(Duck));
donald.name_length = 6;
donald.name = encodeASCII('Donald');
donald.age = 2;
donald.weight = 30;
donald.height = 4;

const mama = new MamaDuck(sizeof(MamaDuck) + sizeof(Duck) * 2);
mama.name_length = 4;
mama.name = encodeASCII('Mama');
mama.age = 9.6;
mama.weight = 12;
mama.height = 9;
mama.n_ducklings = 2;
mama.ducklings = [gerald, donald];

const mom = new MamaDuck(mama.buffer, 0, mama.byteLength);

// Iterator test
for (const duck of mom.ducklings) {
	assert.equal(duck.name.byteLength, 6);
}

assert.deepEqual(mom, mama);

if (process.env.DEBUG) writeFileSync(join(import.meta.dirname, '../tmp/ducks.bin'), mama);

const mom2data = new Uint8Array(mama.byteLength);

if (process.env.DEBUG) {
	const fd = openSync(join(import.meta.dirname, '../tmp/ducks.bin'), 'r');
	readSync(fd, mom2data, 0, mom2data.length, 0);
	closeSync(fd);
} else {
	mom2data.set(mama);
}

const mom2 = new MamaDuck(mom2data.buffer, 0, mom2data.byteLength);

assert.deepEqual(mom2, mama);
