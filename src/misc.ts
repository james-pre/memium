import { Errno, Exception, withErrno } from 'kerium';
import type { Size } from './internal.js';
import { checkStruct, isStatic } from './internal.js';
import * as primitive from './primitives.js';
import type { TypeLike } from './types.js';
/**
 * Gets the size in bytes of a type
 */
export function sizeof<T extends TypeLike>(type: T | T[]): Size<T> {
	if (type === undefined || type === null) return 0 as Size<T>;

	if (Array.isArray(type)) {
		let size = 0;

		for (let i = 0; i < type.length; i++) {
			size += sizeof(type[i]);
		}

		return size as Size<T>;
	}

	// primitive or character
	if (typeof type == 'string') {
		primitive.checkValid(type);

		return primitive.types[primitive.normalize(type)].size as Size<T>;
	}

	if (primitive.isType(type)) return type.size as Size<T>;

	checkStruct(type);

	const constructor = isStatic(type) ? type : type.constructor;
	return constructor[Symbol.metadata].struct.size as Size<T>;
}

/**
 * Returns the offset (in bytes) of a field in a struct.
 */
export function offsetof(type: object, fieldName: string): number {
	checkStruct(type);

	const constructor = isStatic(type) ? type : type.constructor;

	const { fields } = constructor[Symbol.metadata].struct;

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
