// Node overlay — COPY to <ts_node_dir>/eslint.config.js.
// The installer never merges it. Recipes: just ts-node-lint / ts-node-check.
// Map: README.md. Node globals, no DOM, no React plugins.
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'coverage', '**/*.gen.ts']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.node,
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
