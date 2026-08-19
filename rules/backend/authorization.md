---
paths:
  - "**/*.rs"
  - "**/*.go"
  - "**/*.py"
  - "**/*.ts"
title: "Backend — Authorization (Habilitation)"
---

Authentication answers *who is calling*. Authorization answers *what they may do* —
and it is answered **server-side, every time**. The frontend hides what a user
cannot use; hiding is UX, never a control. A hidden button is one `curl` away.

## One permission model for the whole API

Permissions are named in the domain's vocabulary (`invoice:read`, `tenant:admin`),
declared once, and reused by every route. Scattered `if role == "admin"` checks are
not a model: nobody can answer "who can see an invoice?" without grepping.

## Deny by default

Every route declares the permission it requires. A route that declares none is a
review defect, not a public route — absence must fail loudly, never resolve to
"allowed". Where the framework supports it, make the declaration structural (a
typed extractor, a middleware the route cannot bypass) so forgetting it is a
compile or wiring error rather than a silent hole.

## Data-scoped authorization belongs in the query

When the right depends on the row — owner, tenant, organisation — the scope is
applied **in the query**, not by filtering the result afterwards. Post-filtering
returns wrong `total` values and broken pages (`backend/pagination.md`), and it
means the database already read data the caller was never entitled to.

## 403 vs 404

- **403** — the resource exists and the caller may not have it.
- **404** — revealing existence is itself the leak (another tenant's record, a
  private object). Be consistent per resource, and render both through the shared
  error contract (`backend/errors.md`).

## Where the rule lives

The **policy** (who may do what) is domain knowledge — it belongs with the domain,
expressed in its language. The **implementation** (JWT parsing, IdP calls,
middleware, session storage) is infrastructure: `hexagonal/principle.md` bans auth
implementations from the core, and this is the line it draws.

## The permission model is part of the contract

Permissions and scopes appear in the OpenAPI document, alongside the routes they
gate. That is what lets the portal drive its display from them — and only its
display (`portal-http/state.md`). A permission change invalidates the cached data
it governs; a stale cache is a stale authorization.

## Checklist

- [ ] Every route declares a required permission; none defaults to open
- [ ] Permission names come from the domain, and are defined in one place
- [ ] Row-level scope is applied in the query, never post-filtered
- [ ] 403/404 choice is deliberate per resource and rendered as problem+json
- [ ] Auth implementation lives in infrastructure; the policy lives with the domain
- [ ] Permissions and scopes are visible in the OpenAPI document
