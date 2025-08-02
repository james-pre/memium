import assert from 'node:assert';
import { closeSync, openSync, readSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeASCII } from 'utilium/string.js';
import { array, struct, types as t } from '../src/index.js';
import { sizeof } from '../src/misc.js';

const Duck = struct.packed('Duck', {
	name_length: t.uint8,
	name: t.char(64).countedBy('name_length'),
	age: t.float32,
	weight: t.float32,
	height: t.float32,
});

assert.equal(sizeof(Duck), 77);

const MamaDuck = struct.packed.extend(Duck, 'MamaDuck', {
	n_ducklings: t.uint16,
	ducklings: array(Duck).countedBy('n_ducklings'),
});

const gerald = new Duck();
gerald.name_length = 6;
gerald.name = encodeASCII('Gerald');
gerald.age = 1;
gerald.weight = 2;
gerald.height = 3;

assert.equal(gerald.name.byteLength, 6);

const donald = new Duck();
donald.name_length = 6;
donald.name = encodeASCII('Donald');
donald.age = 2;
donald.weight = 30;
donald.height = 4;

const mom = new MamaDuck(new ArrayBuffer(sizeof(MamaDuck) + sizeof(Duck) * 2));
mom.name_length = 4;
mom.name = encodeASCII('Mama');
mom.age = 9.6;
mom.weight = 12;
mom.height = 9;
mom.n_ducklings = 2;
mom.ducklings[0] = gerald;
mom.ducklings[1] = donald;

const mom2 = new MamaDuck(mom.buffer, 0, mom.byteLength);
const momData = new Uint8Array(mom.buffer, mom.byteOffset, mom.byteLength);

// Iterator test
for (const duck of mom2.ducklings) {
	assert.equal(duck.name.byteLength, 6);
}

assert.deepEqual(mom2, mom);

if (process.env.DEBUG) writeFileSync(join(import.meta.dirname, '../tmp/ducks.bin'), momData);

const mom2data = new Uint8Array(mom.byteLength);

if (process.env.DEBUG) {
	const fd = openSync(join(import.meta.dirname, '../tmp/ducks.bin'), 'r');
	readSync(fd, mom2data, 0, mom2data.length, 0);
	closeSync(fd);
} else {
	mom2data.set(momData);
}

const momCopy2 = new MamaDuck(mom2data.buffer, 0, mom2data.byteLength);

assert.deepEqual(momCopy2, mom);
