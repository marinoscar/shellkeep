// Platform-import guard: ONLY the deep-import ban on `@marinoscar/platform-*`,
// applied to the application sources. `npm run check:platform-imports` runs
// this config with --max-warnings=0 (the lint rules of eslint.config.mjs are
// `npm run lint`'s business, not this check's).

import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';
import { APP_SOURCE_FILES, PLATFORM_DEEP_IMPORT_PATTERNS } from './eslint.config.mjs';

export default [
  { ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**'] },
  {
    files: APP_SOURCE_FILES,
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { ecmaVersion: 'latest', sourceType: 'module', ecmaFeatures: { jsx: true } },
    },
    // Registered so existing `eslint-disable` comments naming their rules resolve.
    plugins: { 'react-hooks': reactHooks, '@typescript-eslint': tseslint.plugin },
    linterOptions: { reportUnusedDisableDirectives: 'off' },
    rules: {
      'no-restricted-imports': ['error', { patterns: PLATFORM_DEEP_IMPORT_PATTERNS }],
    },
  },
];
