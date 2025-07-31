import { isType, type Type, type Value } from './types.js';

export interface FieldOptions {
	bigEndian?: boolean;
	length?: number;
	align?: number;
	typeName?: string;
	countedBy?: string;
}

interface FieldConfig<T extends Type> extends FieldOptions {
	type: T;
}

export type FieldConfigInit<T extends Type = Type> = FieldConfig<T> | T | FieldBuilder<T, any>;

type _MaybeLength<T extends Type, Cfg extends FieldOptions = {}> = Cfg extends { length: number }
	? Value<T>[]
	: Value<T>;

export type FieldValue<Init extends FieldConfigInit> = Init extends infer Cfg extends FieldConfig<infer T>
	? _MaybeLength<T, Cfg>
	: Init extends FieldBuilder<infer T, infer Cfg>
		? _MaybeLength<T, Cfg>
		: Init extends Type<infer V>
			? V
			: never;

export function parseFieldConfig<T extends Type>(init: FieldConfigInit<T>): FieldConfig<T> {
	if (isType(init)) return { type: init };
	if (init instanceof FieldBuilder) return init.toInit();
	return init;
}

class _ToArray<T extends Type = Type, Config extends FieldOptions = {}> {
	constructor(type: T, init: Config) {
		function _toArray<N extends number>(length: N): FieldBuilder<T, Config & { length: N }> {
			return new FieldBuilder(type, { ...init, length });
		}
		Object.setPrototypeOf(_toArray, _ToArray.prototype);
		return _toArray;
	}
}

export interface FieldBuilder<T extends Type = Type, Config extends FieldOptions = {}> {
	<N extends number>(length: N): FieldBuilder<T, Config & { length: N }>;
}

export class FieldBuilder<T extends Type = Type, Config extends FieldOptions = {}> extends _ToArray<T, Config> {
	constructor(
		private readonly type: T,
		private readonly init: Config
	) {
		super(type, init);
	}

	align<const N extends number>(align: N): FieldBuilder<T, Config & { align: N }> {
		return new FieldBuilder(this.type, { ...this.init, align });
	}

	countedBy<const K extends string>(field: K): FieldBuilder<T, Config & { countedBy: K }> {
		return new FieldBuilder(this.type, { ...this.init, countedBy: field });
	}

	bigEndian(): FieldBuilder<T, Config & { bigEndian: true }> {
		return new FieldBuilder(this.type, { ...this.init, bigEndian: true });
	}

	toInit(): FieldConfig<T> & Config {
		return { type: this.type, ...this.init };
	}
}

export function array<T extends Type, N extends number>(
	init: FieldConfigInit<T>,
	length: N
): FieldBuilder<T, { length: N }> {
	const config = parseFieldConfig(init);
	return new FieldBuilder(config.type, { ...config, length });
}
