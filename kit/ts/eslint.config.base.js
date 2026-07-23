// Base ESLint flat config (ESLint 9+) — a starting point to COPY and adapt.
// The load-bearing, reusable part is `globalIgnores`: generated code is NEVER
// hand-linted (it is rewritten on every codegen run). Everything else (plugins,
// rule overrides) is project-specific — ADAPT it.
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import {defineConfig, globalIgnores} from 'eslint/config'
// ADAPT: add your framework plugins, e.g.
// import reactHooks from 'eslint-plugin-react-hooks'
// import reactRefresh from 'eslint-plugin-react-refresh'
// ADAPT: to mechanically enforce the kebab-case file/dir convention (see
// rules/ts/code-style.md), add eslint-plugin-check-file — it covers both files
// and folders (unicorn/filename-case does files only). Wired below.
// import checkFile from 'eslint-plugin-check-file'

export default defineConfig([
    // Generated code is never hand-linted (rewritten on each codegen run):
    // OpenAPI client, router tree, any *.gen.ts. ADAPT paths to your layout.
    globalIgnores(['dist', 'src/api/generated', 'src/routeTree.gen.ts', '**/*.gen.ts']),
    {
        files: ['**/*.{ts,tsx}'],
        extends: [
            js.configs.recommended,
            tseslint.configs.recommended,
            // ADAPT: reactHooks.configs['recommended-latest'], reactRefresh.configs.vite,
        ],
        languageOptions: {
            ecmaVersion: 2020,
            globals: globals.browser,
        },
        // ADAPT: project rule overrides go here. Loosen deliberately, never just
        // to make the gate pass — a disabled rule is a gate you no longer have.
        rules: {},
    },
    // ADAPT: enforce kebab-case names (rules/ts/code-style.md). Uncomment after
    // `npm i -D eslint-plugin-check-file` and importing checkFile above.
    // ignoreMiddleExtensions lets foo.test.ts / foo.gen.ts through.
    // {
    //     files: ['src/**/*.{ts,tsx}'],
    //     plugins: {'check-file': checkFile},
    //     rules: {
    //         'check-file/filename-naming-convention': [
    //             'error',
    //             {'**/*.{ts,tsx}': 'KEBAB_CASE'},
    //             {ignoreMiddleExtensions: true},
    //         ],
    //         'check-file/folder-naming-convention': [
    //             'error',
    //             {'src/**/': 'KEBAB_CASE'},
    //         ],
    //     },
    // },
])
