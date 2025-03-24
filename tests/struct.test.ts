import { writeFileSync } from 'fs';
import assert from 'node:assert';
import { join } from 'path';
import { decodeASCII, encodeASCII } from 'utilium/string.js';
import { field, struct, types as t } from '../src/struct.js';
import { BufferView } from 'utilium/buffer.js';

enum Some {
	thing = 1,
	one = 2,
}

@struct()
class Header extends BufferView {
	@t.char(4) public accessor magic_start = encodeASCII('test');

	@t.uint16 public accessor segments: number = 0;

	@t.char(4) public accessor magic_end = encodeASCII('end\0');
}

@struct()
class AnotherHeader extends Header {
	@t.uint64 public accessor _plus: bigint = 0x12345678n;

	@t.uint16 public accessor some: Some = Some.thing;
}

@struct()
class Segment extends BufferView {
	@t.uint64 public accessor id = 0x021;
	@t.uint32(64) public accessor data: number[] = [];
}

@struct()
class BinObject extends Uint8Array {
	@field(AnotherHeader) public accessor header = new AnotherHeader();

	@t.char(32) public accessor comment: Uint8Array = new Uint8Array(32);

	@field(Segment, { length: 16 }) public accessor segments: Segment[] = [new Segment()];
}

const obj = new BinObject();
obj.comment = encodeASCII('!!! Omg, hi! this is cool' + '.'.repeat(32));
obj.header.segments = 1;

const segment = new Segment();
segment.data = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];

obj.segments = [segment];

writeFileSync(join(import.meta.dirname, '../tmp/example.bin'), obj);

const omg = new BinObject(obj.buffer, obj.byteOffset, obj.byteLength);

assert.deepEqual(omg.header.magic_start, obj.header.magic_start);
assert.equal(omg.header.segments, obj.header.segments);
assert.deepEqual(omg.header.magic_end, obj.header.magic_end);
assert.equal(omg.header._plus, obj.header._plus);
assert(typeof omg.header._plus == 'bigint');
assert.deepEqual(decodeASCII(omg.comment), decodeASCII(obj.comment).slice(0, 32));
