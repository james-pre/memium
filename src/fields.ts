import { ArrayType } from './array.js';
import type { StructConstructor, StructInstance } from './structs.js';
import { isType, type Type, type Value } from './types.js';

export interface FieldOptions {
	bigEndian?: boolean;
	align?: number;
	typeName?: string;
	countedBy?: string | ((instance: StructInstance<any>) => number);
}

export interface FieldConfig<T extends Type> extends FieldOptions {
	type: T;
}

export interface Field<T extends Type<any> = Type> {
	name: string;
	type: T;

	/** The static offset of the field */
	offset: number;

	alignment: number;
	countedBy?: string | ((instance: StructInstance<any>) => number);

	/** A C-style type/name declaration string, used for diagnostics */
	readonly decl: string;

	/** Whether the field is little endian */
	littleEndian: boolean;
}

export type FieldConfigInit<T extends Type = Type> = FieldConfig<T> | T | FieldBuilder<T, any>;

export type FieldValue<Init extends FieldConfigInit> =
	Init extends StructConstructor<any>
		? InstanceType<Init>
		: Init extends Type
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
		public readonly type: T,
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

	countedBy<const K extends string>(field: K): FieldBuilder<T, Config & { countedBy: K }>;
	countedBy(fn: (instance: StructInstance<any>) => number): FieldBuilder<T, Config & { countedBy: typeof fn }>;
	countedBy<const CB extends string | ((instance: StructInstance<any>) => number)>(
		countedBy: CB
	): FieldBuilder<T, Config & { countedBy: CB }> {
		return new FieldBuilder(this.type, { ...this.init, countedBy });
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

export function array<T extends Type>(type: T, length: number = 0): FieldBuilder<ArrayType<T>> {
	return new FieldBuilder(new ArrayType(type, length), {});
}
