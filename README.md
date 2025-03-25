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
With shortcuts, you write `@types.type` for a single value or `@types.type(length)` for an array.
Importing `types` as `t` makes this even shorter and is more similar to C-style `example_t` types.

Structs can have attributes, just like in C.
You pass these as arguments to the decorator.
At the moment, you can use `packed` and `align(n)`.

Putting all of it together, you could have something like this:

```ts
import { struct, types as t, packed } from 'lmem';

@struct(packed)
class Person extends Uint8Array {
	@t.char(1) accessor magic = 'P';

	@t.uint16 accessor age = 0;

	@t.uint8 accessor name_length = 0;

	@t.char(32, { countedBy: 'name_length' }) accessor name: Uint8Array;
}
```

Structs in LMem have the same behavior as `struct`s in C.

### Inheritance

You can use normal class inheritance with structs, though you'll need to use `@struct` on any subclasses you want to be structs.

For example:

```ts
import { struct, types as t, packed, sizeof } from 'lmem';

@struct()
class Animal extends Uint8Array {
	@t.char(64) accessor species: Uint8Array;
	@t.float32 accessor age: number;
	@t.float32 accessor weight: number;
}

@struct()
class Duck extends Animal {
	@t.uint8 accessor name_length: number;
	// Dynamically sized array
	@t.char(0, { countedBy: 'name_length' }) accessor name: Uint8Array;
}

const data = new ArrayBuffer(sizeof(Duck) + 32 /* starting memory for the name*/);

const duck = new Duck(data);

const encoder = new TextEncoder();
const encode = encoder.encode.bind(encoder);

Object.assign(duck, {
	species: encode('Mallard'),
	age: 1.5,
	name_length: 5,
	name: encode('Jerry'),
});

// References the same memory
const animal = new Animal(data);

console.log(animal.age); // 1.5
```

### Nesting

As mentioned above, you'll need to use `@field` for non-primitive types (i.e. structs and unions). Below is a more complex example of a custom file format.

```ts
import { struct, types as t, packed, field } from 'lmem';

const encoder = new TextEncoder();
const encode = encoder.encode.bind(encoder);

@struct(packed)
class Header extends Uint8Array {
	@t.char(8) accessor magic: Uint8Array = encode('EXAMPLE!');
	@t.uint16 accessor format: number;
	@t.uint16 accessor app_version: number;
	@t.uint8(16) accessor uuid: Uint8Array;
	@t.float64 accessor timestamp: number;
	@t.uint64(12) accessor padding: BigUint64Array; // pad to 128
}

@struct(packed)
class AppFile extends Uint8Array {
	@field(Header) accessor header: Header;
	@t.uint32 accessor n_sections: number;
	@field(Section) accessor sections: Section[];
}
```

## Pointers

> [!NOTE]
> Pointers are a work in progress.
> What you see below is the planned API.

Pointers are centralized around `Pointer`,
which is used along with array buffers.

The planned API looks like this:

```ts
function alloc(size: number): number;

function free(addr: number | Pointer): void;

function realloc(addr: number | Pointer, size: number): number;

class Pointer<T> extends Number {
	buffer: ArrayBufferLike;
	byteOffset: number; // "physical" address
	constructor(type: T, address: number /* "logical" address */);
	deref(): T;
	increment(amount: number): Pointer<T>;
	decrement(amount: number): Pointer<T>;
}
```

A simple use case:

```ts
import { Animal, Duck } from 'the previous example';
import { sizeof, pointer, alloc } from 'lmem';

const addr = alloc(sizeof(Duck));

const duck_ptr = new Pointer(Duck, addr);

const duck = duck_ptr.deref();
```

## Paged Memory

> [!NOTE]
> Paged memory is a work in progress.
> What you see below is the planned API.

The planned API looks like this:

```ts
interface Page {
	buffer: ArrayBufferLike;
	offset: number;
}

class PagedMemory {
	constructor(readonly pageSize: number)
	add(buffer: ArrayBufferLike): void;
	alloc(address: number, size: number): boolean;
	at(address: number): Uint8Array;
}

let defaultMemory: PagedMemory;
```
