/* Internal stuff used for structs */
import { withErrno } from 'kerium';
import type { WithRequired } from 'utilium';
import { ArrayType } from './array.js';
import type { Field, FieldBuilder, FieldConfig, FieldConfigInit, FieldOptions } from './fields.js';
import {
	dynamicStructSize,
	isStructConstructor,
	isStructInstance,
	type FieldOf,
	type StructInstance,
} from './structs.shared.js';
import { isType, type Type } from './types.js';

function _isBuilder<T extends Type>(init: unknown): init is FieldBuilder<T, any> {
	return (
		(typeof init == 'object' || typeof init == 'function')
		&& init !== null
		&& 'toInit' in init
		&& typeof init.toInit == 'function'
	);
}

function _parseConfig<T extends Type>(init: FieldConfigInit<T>): FieldConfig<T> {
	if (_isBuilder(init)) return init.toInit();
	if (isType(init)) return { type: init };
	return init;
}

export function init<T extends Type = Type, N extends string = string>(
	_name: N | symbol,
	init: FieldConfigInit<T>,
	extraOpts: FieldOptions = {}
): Field<T> & { name: N } {
	if (!_name) throw withErrno('EINVAL', 'Invalid name for struct field');

	if (typeof _name == 'symbol')
		console.warn('Symbol used for struct field name will be coerced to string: ' + _name.toString());
	const name = _name.toString() as N;

	const opt = Object.assign(_parseConfig(init), extraOpts);

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

function __fault(err: any, offset: number) {
	if (!(err instanceof Error) || err.message.toLowerCase() !== 'offset is outside the bounds of the dataview')
		throw err;

	const ex = withErrno('EFAULT', `Segmentation fault (at 0x${offset.toString(16)})`);
	Error.captureStackTrace(ex, __fault);
	throw ex;
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

const kOffsets = Symbol('kOffsets');

/**
 * Get the offset of a field within a struct instance
 * @param cache If true, cache computed value and/or re-use existing cached value. If false, clear any cached offsets
 */
export function offsetOf<T extends {}, N extends keyof T>(
	instance: StructInstance<T> & { [kOffsets]?: { [P in keyof T]?: number } },
	targetField: FieldOf<T> & { name: N },
	cache: boolean
): number {
	let { offset, name } = targetField;

	instance[kOffsets] ||= Object.create(null);
	const offsetCache = instance[kOffsets]!;
	if (offsetCache[name] !== undefined) {
		if (cache) return offsetCache[name];
		else delete offsetCache[name];
	}

	const { fields } = instance.constructor;

	for (const field of fields.slice(0, fields.indexOf(targetField))) {
		if (!cache && offsetCache[field.name] !== undefined) {
			delete offsetCache[field.name];
		}

		if (isDynamicArray(instance, field)) {
			offset += dynamicArraySize(instance, field);
		}

		const value = instance[field.name];
		if (isStructInstance(value) && value.constructor.isDynamic) {
			offset += dynamicStructSize(value);
		}
	}

	if (cache) offsetCache[name] = offset;

	return offset;
}

/** Sets the value of a field */
export function set<T extends {}>(instance: StructInstance<T>, field: FieldOf<T>, value: any, index?: number) {
	if (typeof value == 'string') value = value.charCodeAt(0);
	const offset = instance.byteOffset + offsetOf(instance, field, false) + (index ?? 0) * field.type.size;
	try {
		field.type.set(instance.buffer, offset, value);
		return;
	} catch (err: any) {
		__fault(err, offset);
	}
}

/** Gets the value of a field */
export function get<T extends {}>(instance: StructInstance<T>, field: FieldOf<T>) {
	let type: Type<any> = field.type;
	if (isDynamicArray(instance, field)) {
		const inner = field.type.type;
		type = new ArrayType(inner, _count(instance, field));
	}

	const offset = instance.byteOffset + offsetOf(instance, field, true);
	try {
		return type.get(instance.buffer, offset);
	} catch (err: any) {
		__fault(err, offset);
	}
}
