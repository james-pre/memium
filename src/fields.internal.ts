/* Internal stuff used for structs */
import { withErrno } from 'kerium';
import { ArrayType } from './array.js';
import type { Field, FieldConfigInit, FieldOptions } from './fields.js';
import { parseFieldConfig } from './fields.js';
import {
	dynamicStructSize,
	isStructConstructor,
	isStructInstance,
	type FieldOf,
	type StructInstance,
} from './structs.js';
import { isType, type Type } from './types.js';
import type { WithRequired } from 'utilium';

export function init<T extends Type = Type, N extends string = string>(
	_name: N | symbol,
	init: FieldConfigInit<T>,
	extraOpts: FieldOptions = {}
): Field<T> & { name: N } {
	if (!_name) throw withErrno('EINVAL', 'Invalid name for struct field');

	if (typeof _name == 'symbol')
		console.warn('Symbol used for struct field name will be coerced to string: ' + _name.toString());
	const name = _name.toString() as N;

	const opt = Object.assign(parseFieldConfig(init), extraOpts);

	if (!isType(opt.type)) throw withErrno('EINVAL', `Invalid type for struct field "${name}"`);

	const countedBy = !opt.countedBy
		? ''
		: ` counted_by(${typeof opt.countedBy == 'string' ? opt.countedBy : '<function>'})`;

	return {
		name,
		offset: 0,
		type: opt.type,
		countedBy: opt.countedBy,
		alignment: opt.align ?? opt.type.size,
		decl:
			opt.type instanceof ArrayType
				? `${opt.typeName ?? opt.type.type.name} ${name}[${opt.type.length}]${countedBy}`
				: `${opt.typeName ?? opt.type.name} ${name}`,
		littleEndian: !opt.bigEndian,
	};
}

function __fault(err: any) {
	if (err.message !== 'offset is outside the bounds of the DataView') throw err;
	else throw withErrno('EFAULT', 'Segmentation fault');
}

type DynamicArrayField<T extends {}> = WithRequired<FieldOf<T> & Field<ArrayType<any>>, 'countedBy'>;

export function isDynamicArray<T extends {}>(
	instance: StructInstance<T>,
	field: FieldOf<T>
): field is DynamicArrayField<T> {
	return (
		field.type instanceof ArrayType
		&& field.type.length == 0
		&& !!field.countedBy?.length
		&& !!instance.constructor.isDynamic
	);
}

function _count<T extends {}>(instance: StructInstance<T>, field: DynamicArrayField<T>) {
	let value: unknown =
		typeof field.countedBy == 'function'
			? field.countedBy(instance)
			: instance[field.countedBy as keyof T & string];
	if (typeof value == 'bigint') {
		if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
			throw withErrno('EOVERFLOW', 'countedBy field value exceeds max safe integer');
		}
		value = Number(value);
	}
	if (typeof value != 'number') throw withErrno('EINVAL', 'countedBy field value is not a number');
	return value;
}

/**
 * Get the dynamic size in bytes of a dynamic array field
 * This *includes* the static size of the array items.
 */
export function dynamicArraySize<T extends {}>(instance: StructInstance<T>, field: DynamicArrayField<T>) {
	let size = field.type.type.size * _count(instance, field);
	if (isStructConstructor(field.type.type) && field.type.type.isDynamic) {
		for (const item of instance[field.name] as unknown as Iterable<StructInstance<any>>) {
			size += dynamicStructSize(item);
		}
	}
	return size;
}

export function offsetOf<T extends {}, N extends keyof T>(
	instance: StructInstance<T>,
	targetField: FieldOf<T> & { name: N }
): number {
	let offset = instance.byteOffset + targetField.offset;

	const { fields } = instance.constructor;

	for (const field of fields.slice(0, fields.indexOf(targetField))) {
		if (isDynamicArray(instance, field)) {
			offset += dynamicArraySize(instance, field);
		}

		const value = instance[field.name];
		if (isStructInstance(value) && value.constructor.isDynamic) {
			offset += dynamicStructSize(value);
		}
	}

	return offset;
}

/** Sets the value of a field */
export function set<T extends {}>(instance: StructInstance<T>, field: FieldOf<T>, value: any, index?: number) {
	try {
		if (typeof value == 'string') value = value.charCodeAt(0);
		const offset = offsetOf(instance, field) + (index ?? 0) * field.type.size;
		field.type.set(instance.buffer, offset, value);
		return;
	} catch (err: any) {
		__fault(err);
	}
}

/** Gets the value of a field */
export function get<T extends {}>(instance: StructInstance<T>, field: FieldOf<T>) {
	try {
		let type: Type<any> = field.type;
		if (isDynamicArray(instance, field)) {
			const inner = field.type.type;
			type = new ArrayType(inner, _count(instance, field));
		}

		return type.get(instance.buffer, offsetOf(instance, field));
	} catch (err: any) {
		__fault(err);
	}
}
