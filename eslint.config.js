import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import checkFile from 'eslint-plugin-check-file';

export default tseslint.config(
  {
    ignores: [
      'dist',
      'node_modules',
      '**/*.cjs',
      '**/*.mjs',
      '**/*.config.js',
      '**/*.config.ts',
      '**/dist/**',
      '**/node_modules/**',
      'scripts/**',
      'tools/**',
      'packages/**/tests/**',
      'packages/**/scripts/**',
      'services/api/scripts/**',
      'services/api/tests/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.es2022,
        ...globals.node,
      },
      ecmaVersion: 'latest',
      sourceType: 'module',
      parserOptions: {
        project: [
          './tsconfig.json',
          './apps/*/tsconfig.json',
          './packages/*/tsconfig.json',
          './services/*/tsconfig.json',
        ],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'check-file': checkFile,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'off',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],

      // File naming conventions
      'check-file/filename-naming-convention': [
        'error',
        {
          // App + package source defaults
          'apps/**/src/**/*.tsx': 'PASCAL_CASE',
          'apps/**/src/**/*.ts': 'CAMEL_CASE',
          'packages/**/src/**/*.tsx': 'PASCAL_CASE',
          'packages/**/src/**/*.ts': 'CAMEL_CASE',

          // React components in components/ are PascalCase
          'apps/**/src/**/components/**/*.tsx': 'PASCAL_CASE',
          'packages/**/src/**/components/**/*.tsx': 'PASCAL_CASE',

          // Hooks are camelCase starting with use (any location)
          'apps/**/src/**/use*.{ts,tsx}': 'CAMEL_CASE',
          'packages/**/src/**/use*.{ts,tsx}': 'CAMEL_CASE',

          // Entry + env files
          'apps/**/src/main.tsx': 'CAMEL_CASE',
          'apps/**/src/vite-env.d.ts': 'KEBAB_CASE',

          // Specific PascalCase .ts files
          'apps/**/src/**/EmployeeRegisterStateContext.ts': 'PASCAL_CASE',
        },
        { ignoreMiddleExtensions: true },
      ],

      // Folder naming conventions
      'check-file/folder-naming-convention': [
        'error',
        {
          'apps/**/src/**/': 'KEBAB_CASE',
          'packages/**/src/**/': 'KEBAB_CASE',
          'services/**/src/**/': 'KEBAB_CASE',
        },
      ],
    },
  },
  {
    files: ['**/*.tsx'],
    rules: {
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // Office dashboard is a demo/admin UI with some intentionally loose typing at the moment.
    files: ['apps/office-dashboard/src/**/*.{ts,tsx}'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-misused-promises': 'off',
      '@typescript-eslint/no-floating-promises': 'off',
      '@typescript-eslint/await-thenable': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: [
      'apps/**/src/**/use*.{ts,tsx}',
      'apps/**/src/main.tsx',
      'apps/**/src/vite-env.d.ts',
      'apps/**/src/**/EmployeeRegisterStateContext.ts',
    ],
    rules: {
      'check-file/filename-naming-convention': 'off',
    },
  },
  {
    // API codebase: relax the most aggressive type-safety rules for now.
    files: ['services/api/src/**/*.ts'],
    rules: {
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/only-throw-error': 'off',
      '@typescript-eslint/require-await': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'off',
      '@typescript-eslint/no-base-to-string': 'off',
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'prefer-const': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/restrict-template-expressions': 'off',
      'check-file/filename-naming-convention': 'off',
    },
  }
);
