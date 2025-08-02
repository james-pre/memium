import { writeFileSync } from 'fs';
import assert from 'node:assert';
import { join } from 'path';
import { BufferView } from 'utilium/buffer.js';
import { decodeASCII, encodeASCII } from 'utilium/string.js';
import { $from, field, struct, types as t } from '../src/decorators.js';
import { array } from '../src/fields.js';
import { sizeof } from '../src/misc.js';

enum Some {
	thing = 1,
	one = 2,
}

@struct.packed('Header')
class Header extends $from(BufferView) {
	@t.char(4) public accessor magic_start = encodeASCII('test');

	@t.uint16 public accessor segments: number = 0;

	@t.char(4) public accessor magic_end = encodeASCII('end\0');
}

assert.equal(sizeof(Header), 10);

@struct.packed('AnotherHeader')
class AnotherHeader extends Header {
	@t.uint64 public accessor _plus: bigint = 0x12345678n;

	@t.uint16 public accessor some: Some = Some.thing;
}

assert.equal(sizeof(AnotherHeader), sizeof(Header) + 10);

@struct.packed('Segment')
class Segment extends $from(BufferView) {
	@t.uint64 public accessor id = 0x021;
	@t.uint32(64) public accessor data: ArrayLike<number> = [];
}

assert.equal(sizeof(Segment), 264);

@struct.packed('BinObject')
class BinObject extends $from(Uint8Array) {
	@field(AnotherHeader) public accessor header = new AnotherHeader();

	@t.char(32) public accessor comment: Uint8Array = new Uint8Array(32);

	@field(array(Segment, 16)) public accessor segments: Segment[] = [new Segment()];
}

assert.equal(sizeof(BinObject), sizeof(AnotherHeader) + 32 + sizeof(Segment) * 16);

const obj = new BinObject();
obj.comment = encodeASCII('!!! Omg, hi! this is cool' + '.'.repeat(32));
obj.header.segments = 1;

const segment = new Segment();
const segmentData = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
segment.data = segmentData;

obj.segments = [segment];
assert.deepEqual(Array.from(obj.segments[0].data).slice(0, 16), segmentData);

if (process.env.DEBUG) writeFileSync(join(import.meta.dirname, '../tmp/example.bin'), obj);

const omg = new BinObject(obj.buffer, obj.byteOffset, obj.byteLength);

assert.deepEqual(omg.header.magic_start, obj.header.magic_start);
assert.equal(omg.header.segments, obj.header.segments);
assert.deepEqual(omg.header.magic_end, obj.header.magic_end);
assert.equal(omg.header._plus, obj.header._plus);
assert(typeof omg.header._plus == 'bigint');
assert.deepEqual(decodeASCII(omg.comment), decodeASCII(obj.comment).slice(0, 32));
