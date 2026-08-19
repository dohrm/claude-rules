---
paths:
  - "**/*.rs"
  - "**/*.go"
  - "**/*.py"
  - "**/*.ts"
title: "Backend — API Surface Design"
---

The API models the **domain**, not the screens that consume it. A surface shaped by
the UI ages with the UI: every redesign becomes a backend migration, and the same
business rule ends up implemented twice under two route names.

## One concept, one route

A route names a domain concept and an operation on it. Two screens reading the same
concept read the **same route**.

The recurring mistake: an admin screen and a consultation screen touch the same
data, so a second route appears — `GET /admin/invoices` beside `GET /invoices`. That is not
two endpoints — it is one endpoint and two authorizations.

## Before adding a route, name the difference

| The difference is… | The answer |
|--------------------|------------|
| **who** may see it | an authorization — `backend/authorization.md` |
| **which fields** are returned | a documented projection or a sub-resource |
| **which subset** of the collection | a typed filter param — `backend/pagination.md` |
| **a genuinely different domain operation** | a new route — the only case that earns one |

Only the last row justifies new surface. The first three are the same route wearing
a different hat.

## A verb is not a screen

A route may name a **domain command** — `POST /routes/commands/create`,
`PUT /routes/{id}/commands/disable` (the `cqrs` idiom). The verb comes from the
ubiquitous language, and that is legitimate.

What is not: a route shaped by a component. `GET /dashboard-data`,
`/screens/billing`, `getDataForX` — anything whose name is meaningless outside the
one caller that asked for it. When the UI is redesigned, that route becomes dead
weight nobody dares delete.

## When an aggregate endpoint is legitimate

A real aggregate that would otherwise cost N round-trips on a latency-critical
path. Then it is an explicit, named **read model** (`GET /api/v1/billing/overview`),
documented as such and versioned like any other route. It composes existing domain
reads — it is never where business rules migrate to.

## Rules

- Resource names come from the domain vocabulary (`hexagonal/principle.md`), not
  from the page that displays them.
- A new route is justified by a new domain operation, never by a new screen.
- Same data + different audience = same route + an authorization.
- An aggregate read model is named, documented, and holds no business rule.
- Versioning, OpenAPI emission and DTO policy stay as the `api` profile defines
  them — this rule governs the shape of the surface, not the stack.

## Checklist

- [ ] Every route's name means something to someone who has never seen the UI
- [ ] No route pair differs only by who is allowed to call it
- [ ] Field/subset differences are projections and filters, not new endpoints
- [ ] Any aggregate endpoint is an explicit read model, not a rule container
- [ ] The route vocabulary matches the domain's, not the frontend's
