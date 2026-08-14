import assert from 'node:assert';
import { suite, test } from 'node:test';
import { BufferView } from 'utilium/buffer';
import { $from, struct, types as t } from '../src/decorators.js';
import { struct as structFn, types as ft } from '../src/structs.js';
import { sizeof } from '../src/misc.js';

@struct.packed()
class Normal extends $from(BufferView) {
	@t.uint32 public accessor id = 0;
	@t.uint16 public accessor kind = 0;
}

@struct.packed({ fastFields: true })
class Fast extends $from(BufferView) {
	@t.uint32 public accessor id = 0;
	@t.uint16 public accessor kind = 0;
}

const Plain = structFn.packed('Plain', { id: ft.uint32, kind: ft.uint16 });

await suite('fastFields', () => {
	test('does not change the layout', () => {
		assert.strictEqual(sizeof(Fast), sizeof(Normal));
		assert.strictEqual(sizeof(Fast), 6);
	});

	test('fields are still readable and writable', () => {
		const fast = new Fast();
		fast.id = 0xabcdef;
		fast.kind = 7;

		assert.strictEqual(fast.id, 0xabcdef);
		assert.strictEqual(fast.kind, 7);

		// Values land in the buffer at the same offsets as a normal struct
		const normal = new Normal();
		normal.id = 0xabcdef;
		normal.kind = 7;

		assert.deepStrictEqual(new Uint8Array(fast.buffer), new Uint8Array(normal.buffer));
	});

	test('reads what another view wrote', () => {
		const buffer = new ArrayBuffer(sizeof(Fast));
		const written = new Fast(buffer);
		written.id = 1234;

		assert.strictEqual(new Fast(buffer).id, 1234);
	});

	test('fields are not own properties', () => {
		const fast = new Fast();

		assert.deepStrictEqual(Object.keys(fast), []);
		assert.strictEqual(Object.hasOwn(fast, 'id'), false);
		assert.strictEqual('id' in { ...fast }, false);
	});

	test('fields are still enumerable on the prototype', () => {
		const seen: string[] = [];
		for (const key in new Fast()) seen.push(key);

		assert.deepStrictEqual(seen, ['id', 'kind']);
	});

	test('the default keeps fields as own enumerable properties', () => {
		const normal = new Normal();

		assert.deepStrictEqual(Object.keys(normal), ['id', 'kind']);
		assert.strictEqual(Object.hasOwn(normal, 'id'), true);
		assert.strictEqual('id' in { ...normal }, true);
	});

	test('structs declared without decorators are unaffected', () => {
		const plain = new Plain();
		plain.id = 99;

		assert.strictEqual(plain.id, 99);
		assert.deepStrictEqual(Object.keys(plain), ['id', 'kind']);
		assert.strictEqual(Object.hasOwn(plain, 'id'), true);
	});
});
