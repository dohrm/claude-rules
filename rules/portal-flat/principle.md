---
paths:
  - "**/*.ts"
  - "**/*.tsx"
title: "Frontend Architecture — Flat-Domain Modular Portal"
---

A flat-domain modular structure for a React/TypeScript portal. Transport-agnostic:
this rule owns the layers and their boundaries. How the portal reaches its backend
and where server state lives is in the transport profile — `portal-http/` for
OpenAPI + TanStack Query, `tauri/app.md` for IPC + Zustand. Never both.

## Module Map

```
src/
├── ui/          # Design system — atomic & molecular components
├── layouts/     # Structural shells — slot/children injection only
├── core/        # Global infrastructure — auth, i18n, config, transport client
├── features/    # Business modules — one directory per domain
│   └── {domain}/
│       ├── components/   # Domain-coupled components (e.g. InvoiceList)
│       ├── api/          # Backend boundary — transport calls live here
│       └── logic/        # Screen behaviour — UI state machines, form drafts
└── pages/       # Route entry points — assembly only
```

## Dependency Rules

```
pages/ → features/ → ui/
pages/ → layouts/
features/ → core/
ui/ → (nothing — zero business knowledge)
core/ → (nothing — no feature imports)
```

- `ui/` — pure visual; no API, domain, or global state. Tailwind + CVA; no dynamic class strings that escape the compiler scan.
- `layouts/` — shells with slots/children only; no business content.
- `core/` — shared infrastructure initialized once (auth, i18n, transport client). Stays small — a helper one feature uses stays in that feature.
- `features/{domain}/` — self-contained vertical slice. Deleting a feature = deleting its directory.
- `pages/` — glue only: layout + features for a route; no logic.

Features never import from another `features/` module. Cross-feature data goes
through server state (each feature fetches independently; the transport deduplicates).

## SOLID, applied here

Use a letter only when it names a cut you already need — the module map is the cut.

- **S** — one domain reason to change per feature. `pages/` assemble; they do not grow logic.
- **O** — a new screen is a feature (and a page), not an edit of `core/` or another feature.
- **L** — a `ui/` primitive stays substitutable: same props, no hidden business rule.
- **I** — `core/` stays small. Do not dump every shared helper there.
- **D** — features depend on `core/` and `ui/`, never the reverse; features do not import each other.

## State Categories

| Category | What | Lives in | Example |
|----------|------|----------|---------|
| **Server state** | Data from the backend | `features/{domain}/api/` | invoice list, user profile |
| **App state** | Portal-wide context | `core/` | current_user, locale, theme |
| **URL / view state** | Shareable navigation state | router search params | tab, filters, pagination, search |
| **Local state** | UI-only, ephemeral — never a copy of server state | `features/{domain}/logic/` | modal open, form draft |

URL-worthy state (reload, shared link, back button) lives in search params, not
component state — validation belongs to the transport (`portal-http/react.md`).

## Where Business Logic Lives

The backend. Eligibility, pricing, quotas, permissions and status derivation are
never recomputed in the browser; the screen owns navigation, disclosure,
formatting, form drafts. Cache or store policy that enforces the boundary is in
the transport profile (`portal-http/state.md`, `tauri/app.md`).

## Business Models

The backend owns them. Where it publishes a machine-readable contract, types are
**generated** from it — never hand-written twice. Generation workflow: transport profile.

## Adding a Feature

1. Create `features/{domain}/` with `components/`, `api/`, `logic/`
2. Build from `ui/` — no ad-hoc styled elements in `features/`
3. Register the route in `pages/`
4. Global infrastructure → consume from `core/`, do not duplicate

## LLM Boundary Contract

When asked to build a new view:
- New visual primitives → `ui/`
- New business view → `features/{domain}/components/`
- New data fetching → `features/{domain}/api/`
- New route → `pages/`
- Never mix layers within a single component file
- Never move a business decision into the browser — see the transport profile's state rule
