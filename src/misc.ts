import { Errno, Exception, withErrno } from 'kerium';
import * as primitive from './primitives.js';
import { isStructConstructor, type StructConstructor } from './structs.js';
import type { TypeLike } from './types.js';
import { isType } from './types.js';
import type { ClassLike } from 'utilium';

export type Size<T extends TypeLike | ClassLike> = T extends undefined | null
	? 0
	: T extends primitive.ValidName
		? primitive.Size<T>
		: number;

/**
 * Gets the size in bytes of a type
 */
export function sizeof<T extends TypeLike>(type: T | T[]): Size<T> {
	if (isType(type)) return type.size as Size<T>;

	if (type === undefined || type === null) return 0 as Size<T>;

	if (typeof type == 'object' && isType(type.constructor)) return type.constructor.size as Size<T>;

	if (Array.isArray(type)) {
		let size = 0;
		for (let i = 0; i < type.length; i++) size += sizeof(type[i]);
		return size as Size<T>;
	}

	// primitive or character
	if (typeof type == 'string') {
		primitive.checkValid(type);

		return primitive.types[primitive.normalize(type)].size as Size<T>;
	}

	// eslint-disable-next-line @typescript-eslint/no-base-to-string
	throw new TypeError(`Unable to resolve size of \`${type.toString()}\``);
}

/**
 * Returns the offset (in bytes) of a field in a struct.
 */
export function offsetof(type: object, fieldName: string): number {
	let constructor: StructConstructor<any>;
	if (isStructConstructor(type)) constructor = type;
	else if (isStructConstructor(type.constructor)) constructor = type.constructor;
	else throw withErrno('EINVAL', 'Type is not a struct or struct constructor');

	const { fields } = constructor;

	if (!(fieldName in fields)) throw withErrno('EINVAL', 'Struct does not have field: ' + fieldName);

	return fields[fieldName].offset;
}

export class MemoryError extends Exception {
	constructor(
		err: keyof typeof Errno,
		public readonly address: number
	) {
		super(Errno[err]);
	}
}
