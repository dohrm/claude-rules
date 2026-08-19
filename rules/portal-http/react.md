---
paths:
  - "**/*.ts"
  - "**/*.tsx"
title: "Portal — HTTP Transport (OpenAPI + TanStack)"
---

The HTTP transport for a flat-domain portal: the layers come from
`portal-flat/principle.md`, this rule owns how they reach the backend.

## Business Models — OpenAPI Generation

The client is **generated from the backend OpenAPI spec** by
[`@hey-api/openapi-ts`](https://heyapi.dev) — no manual type duplication.

```bash
npm run generate:api        # fetches the spec from the running backend
npm run generate:api:file   # uses a local spec file ($OPENAPI_SPEC — the CI artifact)
```

Generated output lives in `src/api/generated/` (never hand-edited — see the
`.gen.ts` rule in the TypeScript gates), produced by these plugins:

| Plugin | Emits |
|--------|-------|
| `@hey-api/client-axios` | the Axios client (base URL & auth via `runtimeConfigPath`) |
| `@tanstack/react-query` | option factories per endpoint — `xxxOptions()`, `xxxMutation()`, `xxxQueryKey()` |
| `@hey-api/sdk` | typed request functions |
| `@hey-api/typescript` (`enums: 'javascript'`) | request/response types |
| `zod` (`requests: true`) | Zod schemas for request bodies — the contract-aligned base for form validation |

**Rule:** never hand-write anything the contract can produce — types, query/mutation
options, and request schemas are always generated. You import the subset you use; the rest
tree-shakes out of the bundle. The only runtime schema you write by hand is the
URL one (below), because it isn't in the contract.

## Server State — TanStack Query

All server interactions go through the generated option factories. No raw `fetch`,
no manual `useEffect` for data fetching.

```tsx
// features/billing/api/index.ts — re-export, add domain context
export { billingFilterOptions, billingCreateMutation } from '@/api/generated/@tanstack/react-query.gen';

// features/billing/components/billing-list.tsx
const { data, isLoading } = useQuery(billingFilterOptions({ query: { skip: 0, limit: 20 } }));
```

The factories carry no cache policy: what a mutation invalidates, what a logout
clears, and what the browser is allowed to derive are all in `portal-http/state.md`.

## App State — Portal Context

Portal-wide state (current user, locale, theme) lives in `core/contexts/` as React Contexts.
Not in global stores — these are stable values that change rarely and wrap the full app.

```
core/
└── contexts/
    ├── auth-context.tsx      # current_user, isAuthenticated, logout()
    ├── locale-context.tsx    # locale, setLocale()
    └── theme-context.tsx     # theme, setTheme()
```

Provider hierarchy in `app/providers.tsx`:

```tsx
<LocaleProvider>
  <ThemeProvider>
    <AuthProvider>       {/* depends on locale for error messages */}
      <QueryClientProvider>
        {children}
      </QueryClientProvider>
    </AuthProvider>
  </ThemeProvider>
</LocaleProvider>
```

Consume via typed hooks:

```tsx
const { user, logout } = useAuth();
const { locale } = useLocale();
```

## Runtime Validation — Zod

Zod is the **single runtime-validation vocabulary**, applied **only at untrusted
boundaries**:

| Boundary | Trusted? | Validation |
|----------|----------|------------|
| API response | ✅ by the contract | none — checked at compile time via the generated types |
| Form / input body | ❌ user input | **generated** Zod (the `zod` plugin's request schemas) — aligned to the contract |
| URL search params | ❌ user-editable | **hand-written** Zod — a routing concern, absent from the OpenAPI spec |

Never validate an API response at runtime: re-checking a contracted response means
distrusting your own source of truth. Validate what the user can type, nothing else.

## Routing & URL State — TanStack Router

Routing uses **TanStack Router**. View state that belongs in the URL — active tab,
filters, pagination, search query — lives in **typed search params**, not component
state: it is shareable, survives reload, and restores on back/forward. Search params
are validated at the route boundary with a hand-written Zod schema.

## `src/api/` Structure

```
src/api/
└── generated/              # never edit manually — rewritten on each codegen run
    ├── types.gen.ts
    ├── sdk.gen.ts
    ├── zod.gen.ts
    └── @tanstack/
        └── react-query.gen.ts

src/config/
└── hey-api.ts              # runtimeConfig for the generated client — base URL, auth interceptor
```

## Rules

- All server interactions via the generated option factories — no raw fetch in features
- Never edit files in `src/api/generated/` — regenerate instead
- Everything the contract can produce is generated (types, query/mutation options, request schemas); hand-write only what it can't (URL search-param schemas)
- Zod validates untrusted input only — forms and URL params, never API responses
- URL-worthy view state (tab, filters, pagination, search) lives in TanStack Router search params, not component state
- Portal state (user, locale, theme) in `core/contexts/`, not in feature-level state
- Server-state ownership, invalidation and cache-clean policy: `portal-http/state.md`
