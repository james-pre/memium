import { writeFileSync } from 'fs';
import assert from 'node:assert';
import { join } from 'path';
import { decodeASCII, encodeASCII } from 'utilium/string.js';
import { array } from '../src/fields.js';
import { sizeof } from '../src/misc.js';
import { struct, types as t } from '../src/structs.js';

enum Some {
	thing = 1,
	one = 2,
}

const Header = struct.packed('Header', {
	magic_start: t.char(4),
	segments: t.uint16,
	magic_end: t.char(4),
});

assert.equal(sizeof(Header), 10);

const AnotherHeader = struct.extend(
	Header,
	'AnotherHeader',
	{
		_plus: t.uint64,
		some: t.uint16.$type<Some>(),
	},
	{ isPacked: true }
);

assert.equal(sizeof(AnotherHeader), sizeof(Header) + 10);

const Segment = struct.packed('Segment', {
	id: t.uint64,
	data: t.uint32(64),
});

assert.equal(sizeof(Segment), 264);

const BinObject = struct.packed('BinObject', {
	header: AnotherHeader,
	comment: t.char(32),
	segments: array(Segment, 16).countedBy('header.segments'),
});

assert.equal(sizeof(BinObject), sizeof(AnotherHeader) + 32 + sizeof(Segment) * 16);

const obj = new BinObject();
obj.comment = encodeASCII('!!! Omg, hi! this is cool' + '.'.repeat(32));
obj.header.segments = 1;

console.log(Object.keys(obj));

const segment = new Segment();
const segmentData = new Uint32Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
segment.data = segmentData;

obj.segments[0] = segment;
assert.deepEqual(Array.from(obj.segments[0].data).slice(0, 16), segmentData);

if (process.env.DEBUG)
	writeFileSync(
		join(import.meta.dirname, '../tmp/example.bin'),
		new Uint8Array(obj.buffer, obj.byteOffset, obj.byteLength)
	);

const omg = new BinObject(obj.buffer, obj.byteOffset, obj.byteLength);

assert.deepEqual(omg.header.magic_start, obj.header.magic_start);
assert.equal(omg.header.segments, obj.header.segments);
assert.deepEqual(omg.header.magic_end, obj.header.magic_end);
assert.equal(omg.header._plus, obj.header._plus);
assert(typeof omg.header._plus == 'bigint');
assert.deepEqual(decodeASCII(omg.comment), decodeASCII(obj.comment).slice(0, 32));
