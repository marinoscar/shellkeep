// =============================================================================
// ESLint flat config for the applications (apps/api and apps/web)
// =============================================================================
//
// Modelled on the platform's root config, scoped to application sources:
//
//   - the recommended ESLint and typescript-eslint rules (the same set the
//     legacy .eslintrc.js asked for, which ESLint 9+ ignores);
//   - a deep-import ban on the `@marinoscar/platform-*` packages. An app
//     reaches a platform package only through its `exports` map (declared
//     subpaths such as `@marinoscar/platform-api/core`), never `/src`, `/dist`
//     or a slice's `internal/` folder.
//
// Run: `npm run lint` (apps). `npm run check:platform-imports` runs only the
// deep-import ban, through eslint.platform-imports.config.mjs.
// =============================================================================

import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

/** Application sources this config applies to. */
export const APP_SOURCE_FILES = ['apps/{api,web}/src/**/*.{ts,tsx}'];

/** Deep-import bans on the published platform packages. */
export const PLATFORM_DEEP_IMPORT_PATTERNS = [
  {
    group: ['@marinoscar/platform-*/src', '@marinoscar/platform-*/src/**'],
    message: 'Import a platform package through its exports map, never its src/ folder.',
  },
  {
    group: ['@marinoscar/platform-*/dist', '@marinoscar/platform-*/dist/**'],
    message: 'Import a platform package through its exports map, never its dist/ folder.',
  },
  {
    group: ['@marinoscar/platform-*/**/internal', '@marinoscar/platform-*/**/internal/**'],
    message: "A slice's internal/ folder is private to that slice.",
  },
];

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**'] },
  {
    files: APP_SOURCE_FILES,
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
    },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-restricted-imports': ['error', { patterns: PLATFORM_DEEP_IMPORT_PATTERNS }],
    },
  },
  {
    // Test doubles routinely need `any`.
    files: ['apps/{api,web}/src/**/*.{test,spec}.{ts,tsx}', 'apps/web/src/__tests__/**/*.{ts,tsx}'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
