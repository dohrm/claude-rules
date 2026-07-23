// hey-api OpenAPI → TypeScript client generator — COPY to your frontend root and adapt.
//
// Generates the typed Axios client, TanStack Query hooks, request/response types,
// and request-body Zod schemas from the backend OpenAPI spec into
// `src/api/generated/`. That directory is NEVER hand-edited — it is rewritten on
// every run and must sit in eslint `globalIgnores` + be excluded from tsconfig.
//
// Wiring (one-time):
//   npm i -D @hey-api/openapi-ts
//   npm i @hey-api/client-axios @tanstack/react-query zod
//   package.json scripts:
//     "generate:api":      "openapi-ts"   (live backend — the local dev flow)
//     "generate:api:file": "openapi-ts"   (CI sets OPENAPI_SPEC to the spec artifact)
//   create src/config/hey-api.ts exporting the client runtimeConfig (base URL, auth interceptor).
import {defaultPaginationKeywords, defineConfig} from '@hey-api/openapi-ts'

export default defineConfig({
    input: {
        // OPENAPI_SPEC: a local spec file (the CI `openapi-spec` artifact), used by
        // `generate:api:file`; falls back to the live backend for `generate:api`.
        // ADAPT: the backend URL / port to your stack.
        path: process.env.OPENAPI_SPEC ?? 'http://localhost:9000/@/doc/openapi.json',
        // ADAPT: extra pagination keywords your API uses beyond hey-api's defaults.
        pagination: {keywords: [...defaultPaginationKeywords, 'skip', 'limit']},
    },
    output: {path: 'src/api/generated'},
    plugins: [
        // ADAPT: runtimeConfigPath points at your client config (base URL, auth interceptor).
        {name: '@hey-api/client-axios', runtimeConfigPath: '@/config/hey-api.ts'},
        {name: '@tanstack/react-query'},
        '@hey-api/sdk',
        // enums as plain JS objects, not TS `enum` (avoids the nominal-typing / runtime footguns).
        {name: '@hey-api/typescript', enums: 'javascript'},
        // Request-body Zod schemas ONLY — the contract-aligned base for form validation.
        // NOT `responses`: a contracted response is trusted; re-validating it at runtime
        // means distrusting your own source of truth. Validate what the user can type.
        {name: 'zod', requests: true},
    ],
})
