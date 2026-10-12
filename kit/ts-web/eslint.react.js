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
      'no-restricted-syntax': ['error', {
        selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
        message: 'No raw HTML: render text, or sanitize at one reviewed helper.',
      }],
    },
  },
])
