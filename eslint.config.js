// ESLint (flat config). Pragmático: detecta bugs reales (promesas sin await, vars sin usar),
// sin ser pedante con `any` (el código maneja JSON dinámico a propósito).
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
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': ['warn', { checksVoidReturn: false }],
      '@typescript-eslint/await-thenable': 'warn',
    },
  },
];
