// Language-floor ESLint flat config (ESLint 9+) — COPY to <ts_dir>/eslint.config.js.
// The installer never merges it. Recipes: just ts-lint / ts-check. Map: README.md.
//
// Generated code is never hand-linted (rewritten on each codegen run).
// no-explicit-any / no-non-null-assertion are why rules/ts/quality-gates.md
// does not need a second eslint pass. Adapt globalIgnores to your layout.
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'coverage', 'src/api/generated', 'src/routeTree.gen.ts', '**/*.gen.ts']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.es2022,
      // Type-aware linting: the promise and exhaustiveness rules below need the
      // checker. Config files at the root are outside tsconfig's `include`.
      parserOptions: {
        projectService: { allowDefaultProject: ['*.config.ts'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      // A promise is awaited, returned, or `void`-ed on purpose — never dropped.
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/switch-exhaustiveness-check': 'error',
      '@typescript-eslint/no-implied-eval': 'error',
      'no-eval': 'error',
      eqeqeq: ['error', 'smart'],
    },
  },
])
