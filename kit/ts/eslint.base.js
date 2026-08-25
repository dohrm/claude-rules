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
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
])
