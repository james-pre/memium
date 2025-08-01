/* Internal stuff used for structs */
import { withErrno } from 'kerium';
import { _throw } from 'utilium';
import { ArrayType, StructArray } from './array.js';
import { parseFieldConfig, type Field, type FieldConfigInit, type FieldOptions } from './fields.js';
import type { StructInstance } from './structs.js';
import { isType, type Type } from './types.js';

export function __fieldInit<T extends Type = Type>(
	_name: string | symbol,
	init: FieldConfigInit<T>,
	extraOpts: FieldOptions = {}
): Field<T> {
	if (!_name) throw withErrno('EINVAL', 'Invalid name for struct field');

	if (typeof _name == 'symbol')
		console.warn('Symbol used for struct field name will be coerced to string: ' + _name.toString());
	const name = _name.toString() as keyof T & string;

	const opt = Object.assign(parseFieldConfig(init), extraOpts);

	if (!isType(opt.type)) throw withErrno('EINVAL', `Invalid type for struct field "${name}"`);

	return {
		name,
		offset: 0,
		type: opt.type,
		countedBy: opt.countedBy,
		alignment: opt.align ?? opt.type.size,
		decl:
			opt.type instanceof ArrayType
				? `${opt.typeName ?? opt.type.type.name} ${name}[${opt.type.length}]${opt.countedBy ? ` counted_by(${opt.countedBy})` : ''}`
				: `${opt.typeName ?? opt.type.name} ${name}`,
		littleEndian: !opt.bigEndian,
	} satisfies Field;
}

function __fault(err: any) {
	if (err.message !== 'offset is outside the bounds of the DataView') throw err;
	else throw withErrno('EFAULT', 'Segmentation fault');
}

/** Gets the length of a field */
function __fieldLength(instance: StructInstance, type?: Type, countedBy?: string): number {
	if (!(type instanceof ArrayType)) return -1;
	let { length } = type;
	if (typeof countedBy == 'string') length = Math.min(length, Number(instance[countedBy as keyof typeof instance]));
	return Number.isSafeInteger(length) && length >= 0
		? length
		: _throw(withErrno('EINVAL', 'Array lengths must be natural numbers'));
}

/** Sets the value of a field */
export function __fieldSet<T extends Type>(instance: StructInstance, field: Field<T>, value: any, index?: number) {
	const { type, countedBy } = field;
	const length = __fieldLength(instance, type, countedBy as any);

	try {
		if (length === -1 || typeof index === 'number') {
			if (typeof value == 'string') value = value.charCodeAt(0);
			const offset = instance.byteOffset + field.offset + (index ?? 0) * type.size;
			type.set(instance.buffer, offset, value);
			return;
		}

		let offset = instance.byteOffset + field.offset;
		for (let i = 0; i < Math.min(length, value.length); i++) {
			type.set(instance.buffer, offset, value[i]);
			offset += type.size;
		}
	} catch (err: any) {
		__fault(err);
	}
}

/** Gets the value of a field */
export function __fieldGet<T extends Type>(instance: StructInstance, field: Field<T>, index?: number) {
	const { type, countedBy } = field;
	const length = __fieldLength(instance, type, countedBy);

	const offset = instance.byteOffset + field.offset + (index ?? 0) * field.type.size;

	try {
		if (length === -1 || typeof index === 'number') {
			return type.get(instance.buffer, offset);
		}

		if (length !== 0 && type.array) {
			return new type.array(instance.buffer, offset, length * type.size);
		}

		const FieldArray = StructArray(type);
		return new FieldArray(instance.buffer, offset, length * type.size);
	} catch (err: any) {
		__fault(err);
	}
}
