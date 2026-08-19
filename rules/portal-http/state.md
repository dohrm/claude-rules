---
paths:
  - "**/*.ts"
  - "**/*.tsx"
title: "Portal — Server-State-Driven & Cache Policy"
---

The backend owns the truth; the screen owns its behaviour. One test settles the
borderline cases: **if the server disagreed, who would be right?** If the answer is
the server, the browser does not compute it.

## Server state has exactly one home

The query cache. Never copy `data` into `useState`/`useReducer`, a context, or a
store — a copy is a second source of truth that goes stale in silence. An effect
mirroring a response into state is a review blocker (`react/quality-gates.md`,
"Derive, don't sync").

## The generated client invalidates nothing

The `@tanstack/react-query` plugin emits **option factories**, not hooks:
`xxxOptions()`, `xxxMutation()`, `xxxQueryKey()`. The generated mutation is a bare
`mutationFn` — no `onSuccess`, no invalidation. Every mutation declares its own
invalidation set, by hand, in `features/{domain}/api/` — never in the component
that fires it. Invalidation scattered across `pages/` is how a portal loses track
of what its cache holds.

```ts
// features/billing/api/index.ts
export const useBillingCreate = () => {
  const qc = useQueryClient()
  return useMutation({
    ...billingCreateMutation(),
    onSuccess: () => qc.invalidateQueries({queryKey: billingFilterQueryKey()}),
  })
}
```

## Cache-clean policy

| Event | Action |
|-------|--------|
| Mutation succeeds | `invalidateQueries` on the keys it touched |
| Logout, identity or tenant change | `queryClient.clear()` — one identity's cache never survives into the next |
| Permissions change | invalidate everything that permission gates: a stale cache is a stale authorization |
| Feature unmounts | nothing — `gcTime` handles it |

`staleTime`/`gcTime` are chosen per resource; a bare `new QueryClient()` is a
default, not a decision. `refetchInterval` never substitutes for an invalidation
you failed to write.

## The screen does not re-derive a business fact

- ✅ Labels, formatting, i18n, display-only sort/filter over a fetched page,
  toggles, wizard steps, form drafts.
- ✅ A **UI approximation** the product asked for (a running total, an estimated
  duration) — labelled as an estimate, never persisted, never the basis of a
  decision the server also makes. The screen shows an order of magnitude, not a
  commitment.
- ❌ Eligibility, pricing, quotas, permission decisions, status derivation,
  business validation. Generated Zod mirrors the contract — it does not decide it.

## Checklist

- [ ] No server payload copied into component state, a context, or a store
- [ ] Every mutation declares its invalidation set, in `features/{domain}/api/`
- [ ] Logout / tenant switch clears the query cache
- [ ] `staleTime`/`gcTime` chosen per resource, not defaulted by accident
- [ ] No business rule in the browser; any UI estimate is labelled as one
