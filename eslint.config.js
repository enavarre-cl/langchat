// ESLint (flat config). Pragmatic: catches real bugs (unawaited promises, unused vars) without
// being pedantic about `any` (the code handles dynamic JSON on purpose).
const tseslint = require('@typescript-eslint/eslint-plugin');
const parser = require('@typescript-eslint/parser');

module.exports = [
  {
    files: ['src/**/*.ts'],
    ignores: ['src/test/**'],
    languageOptions: {
      parser,
      parserOptions: { project: './tsconfig.json' },
    },
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      'no-var': 'error',
      'prefer-const': 'warn',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['warn', { checksVoidReturn: false }],
      '@typescript-eslint/await-thenable': 'warn',
    },
  },
];
