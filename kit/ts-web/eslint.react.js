// React overlay — COPY to <ts_web_dir>/eslint.config.js.
// The installer never merges it. Recipes: just ts-web-lint / ts-web-check.
// Map: README.md. ts-tauri ships the same overlay (the webview is React).
//
// react-hooks is why Rules of Hooks do not need a second eslint pass.
// jsx-a11y is the a11y floor (roles / labels). RTL query style stays prose.
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'coverage', 'src/api/generated', 'src/routeTree.gen.ts', '**/*.gen.ts']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      jsxA11y.flatConfigs.recommended,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
])
