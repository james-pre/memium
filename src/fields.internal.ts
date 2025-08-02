/* Internal stuff used for structs */
import { withErrno } from 'kerium';
import { ArrayType } from './array.js';
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

/** Sets the value of a field */
export function __fieldSet<T extends Type>(instance: StructInstance, field: Field<T>, value: any, index?: number) {
	try {
		if (typeof value == 'string') value = value.charCodeAt(0);
		const offset = instance.byteOffset + field.offset + (index ?? 0) * field.type.size;
		field.type.set(instance.buffer, offset, value);
		return;
	} catch (err: any) {
		__fault(err);
	}
}

/** Gets the value of a field */
export function __fieldGet<T extends Type>(instance: StructInstance, field: Field<T>) {
	try {
		return field.type.get(instance.buffer, instance.byteOffset + field.offset);
	} catch (err: any) {
		__fault(err);
	}
}
