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
])
