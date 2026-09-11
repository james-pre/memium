import assert from 'node:assert';
import { suite, test } from 'node:test';
import { array } from '../src/fields.js';
import { offsetof, sizeof } from '../src/misc.js';
import { struct, types as t } from '../src/structs.js';

// `struct fs_sysfs_path` from `<linux/fs.h>`
const SysfsPath = struct('alignment_fs_sysfs_path', {
	len: t.uint8,
	name: t.uint8(128),
});

// `struct termios` from `<asm-generic/termbits.h>`
const Termios = struct('alignment_termios', {
	iflag: t.uint32,
	oflag: t.uint32,
	cflag: t.uint32,
	lflag: t.uint32,
	line: t.uint8,
	cc: t.uint8(19),
});

// `struct statfs` from `<asm-generic/statfs.h>`
const StatFs = struct('alignment_statfs', {
	type: t.int64,
	bsize: t.int64,
	blocks: t.uint64,
	bfree: t.uint64,
	bavail: t.uint64,
	files: t.uint64,
	ffree: t.uint64,
	fsid: t.int32(2),
	namelen: t.int64,
	frsize: t.int64,
	flags: t.int64,
	spare: t.int64(4),
});

const Inner = struct('alignment_inner', { a: t.uint32, b: t.uint32, c: t.uint32 });

const Outer = struct('alignment_outer', { tag: t.uint8, inner: Inner });

const Explicit = struct('alignment_explicit', {
	len: t.uint8,
	name: { type: t.uint8(8).toInit().type, align: 8 },
});

suite('Alignment', () => {
	test('an array aligns to its element, not to the whole array', () => {
		assert.equal(offsetof(SysfsPath, 'name'), 1);
		assert.equal(sizeof(SysfsPath), 129);
	});

	test('an array of bytes after wider fields', () => {
		assert.equal(offsetof(Termios, 'cc'), 17);
		assert.equal(sizeof(Termios), 36);
	});

	test('arrays of wider types still align to that type', () => {
		assert.equal(offsetof(StatFs, 'fsid'), 56);
		assert.equal(offsetof(StatFs, 'namelen'), 64);
		assert.equal(offsetof(StatFs, 'spare'), 88);
		assert.equal(sizeof(StatFs), 120);
	});

	test('a nested struct aligns to its widest member, not to its size', () => {
		assert.equal(Inner.alignment, 4);
		assert.equal(offsetof(Outer, 'inner'), 4);
		assert.equal(sizeof(Outer), 16);
	});

	test('an explicit alignment still wins', () => {
		assert.equal(offsetof(Explicit, 'name'), 8);
		assert.equal(sizeof(Explicit), 16);
	});

	test('an array of structs aligns to the struct', () => {
		const Many = struct('alignment_many', { tag: t.uint8, items: array(Inner, 2) });
		assert.equal(offsetof(Many, 'items'), 4);
		assert.equal(sizeof(Many), 28);
	});
});
