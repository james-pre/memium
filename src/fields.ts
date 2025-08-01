import { ArrayType } from './array.js';
import { isType, type Type, type Value } from './types.js';

export interface FieldOptions {
	bigEndian?: boolean;
	align?: number;
	typeName?: string;
	countedBy?: string;
}

export interface FieldConfig<T extends Type> extends FieldOptions {
	type: T;
}

export interface Field<T extends Type<any> = Type> {
	name: string;
	type: T;
	offset: number;

	alignment: number;
	countedBy?: string;

	/** A C-style type/name declaration string, used for diagnostics */
	readonly decl: string;

	/** Whether the field is little endian */
	littleEndian: boolean;
}

export type FieldConfigInit<T extends Type = Type> = FieldConfig<T> | T | FieldBuilder<T, any>;

export type FieldValue<Init extends FieldConfigInit> = Init extends Type
	? Value<Init>
	: Init extends FieldConfigInit<infer T extends Type>
		? Value<T>
		: never;

export function parseFieldConfig<T extends Type>(init: FieldConfigInit<T>): FieldConfig<T> {
	if (isType(init)) return { type: init };
	if (init instanceof FieldBuilder) return init.toInit();
	return init;
}

type _ToArray<T extends Type = Type, Config extends FieldOptions = {}> = {
	(length: number): FieldBuilder<ArrayType<T>, Config>;
};

export interface FieldBuilder<T extends Type = Type, Config extends FieldOptions = {}> extends _ToArray<T, Config> {}

export class FieldBuilder<T extends Type = Type, Config extends FieldOptions = {}> {
	constructor(
		private readonly type: T,
		private readonly init: Config
	) {
		const _toArray = ((length: number): FieldBuilder<ArrayType<T>, Config> => {
			return new FieldBuilder(new ArrayType(type, length), init) as any as FieldBuilder<ArrayType<T>, Config>;
		}) as any as FieldBuilder<T, Config>;
		Object.setPrototypeOf(_toArray, new.target.prototype);
		Object.assign(_toArray, { type, init });
		return _toArray;
	}

	/**
	 * Align the field to a given byte boundary.
	 */
	align<const N extends number>(align: N): FieldBuilder<T, Config & { align: N }> {
		return new FieldBuilder(this.type, { ...this.init, align });
	}

	countedBy<const K extends string>(field: K): FieldBuilder<T, Config & { countedBy: K }> {
		return new FieldBuilder(this.type, { ...this.init, countedBy: field });
	}

	/**
	 * Set the field to big-endian.
	 */
	bigEndian(): FieldBuilder<T, Config & { bigEndian: true }> {
		return new FieldBuilder(this.type, { ...this.init, bigEndian: true });
	}

	toInit(): FieldConfig<T> & Config {
		return { type: this.type, ...this.init };
	}

	/**
	 * Override the typescript type of the field's value, for example to override `number` with an enum type.
	 * This does not have any runtime effects.
	 */
	$type<NewValue>(): FieldBuilder<T & Type<NewValue>, Config> {
		return new FieldBuilder(this.type as T & Type<NewValue>, this.init);
	}
}

export function array<T extends Type>(type: T, length: number): FieldBuilder<ArrayType<T>> {
	return new FieldBuilder(new ArrayType(type, length), {});
}
