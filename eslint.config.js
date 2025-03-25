import shared from 'utilium/eslint';

export default [
	...shared(import.meta.dirname),
	{
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
			'@typescript-eslint/no-implied-eval': 'off',
			'@typescript-eslint/no-wrapper-object-types': 'off',
		},
	},
];
