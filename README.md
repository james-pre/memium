# lmem: Linear Memory for TypeScript

LMem is a library for working with linear memory in TypeScript.
It enables you to use binary structs and pointers<sup>[1]</sup> easily,
without having to worry about the underlying operations.
LMem is designed with performance and a seamless user experience in mind.

<sup>[1] Work In Progress</sup>

## Installation

```sh
npm install lmem
```

If you're using LMem, especially for big projects, please consider supporting the project.

## Structs

The `@struct` decorator turns a class into a struct.
Like the various [typed array](https://mdn.io/TypedArray) classes and [`DataView`](https://mdn.io/DataView),
Structs are `ArrayBufferView`s, meaning they have a `buffer`, `byteOffset`, and `byteLength`.
They also have a similar constructor to typed arrays.
You will need extend a class that implements these, or implement that functionality your self.
`Uint8array` and Utilium's `BufferView` are good choices.

Once you have a struct, you can decorate members of the class as fields on the struct.
The easiest way to do this is using the shortcuts for primitives,
though you will need to use `@field` for nested structs and unions.
Due to

Putting all of it together, you could have something like this:

```ts
import { struct, types as t } from 'lmem';

const encoder = new TextEncoder();
const encode = encoder.encode.bind(encoder);

@struct({ packed: true }) // options are optional, `struct() works too`
class Person extends Uint8Array {
	@t.char(1) accessor magic = encode('P'); // @t.type(length) is a shortcut for arrays

	@t.uint16 accessor age = 0;

	@t.uint8 accessor name_length = 0;

	@t.char(32, { countedBy: 'name_length' }) accessor name = new Uint8Array(32);
}
```

Structs in LMem have the same behavior as `struct`s in C.

### Inheritance

_Work In Progress_

### Nesting

_Work In Progress_
