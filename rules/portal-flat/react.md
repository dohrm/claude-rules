---
paths:
  - "**/*.ts"
  - "**/*.tsx"
title: "React Portal Architecture"
---

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
| `@tanstack/react-query` | `useQuery` / `useMutation` hooks per endpoint |
| `@hey-api/sdk` | typed request functions |
| `@hey-api/typescript` (`enums: 'javascript'`) | request/response types |
| `zod` (`requests: true`) | Zod schemas for request bodies — the contract-aligned base for form validation |

**Rule:** never hand-write anything the contract can produce — types, hooks, and
request schemas are always generated. You import the subset you use; the rest
tree-shakes out of the bundle. The only runtime schema you write by hand is the
URL one (below), because it isn't in the contract.

## Server State — TanStack Query

All server interactions go through **generated TanStack Query hooks**. No raw `fetch`, no manual `useEffect` for data fetching.

```tsx
// features/billing/api/index.ts — re-export generated hooks, add domain context
export { useBillingFilter, useBillingCreate } from '@/api/generated/@tanstack/react-query.gen';

// features/billing/components/billing-list.tsx
const { data, isLoading } = useBillingFilter({ query: { skip: 0, limit: 20 } });
```

Cache invalidation is handled by generated mutation hooks — mutations invalidate related queries by convention.

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

## Cross-Feature State

Cross-feature data goes through server state (TanStack Query), not shared stores.
If two features need the same data, they each call the same generated hook — the cache deduplicates the request.

Never share state between features via props-drilling or a shared store — use the query cache.

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

- All server interactions via generated TanStack Query hooks — no raw fetch in features
- Never edit files in `src/api/generated/` — regenerate instead
- Everything the contract can produce is generated (types, hooks, request schemas); hand-write only what it can't (URL search-param schemas)
- Zod validates untrusted input only — forms and URL params, never API responses
- URL-worthy view state (tab, filters, pagination, search) lives in TanStack Router search params, not component state
- Portal state (user, locale, theme) in `core/contexts/`, not in feature-level state
- Cross-feature data via query cache, not shared stores
