---
paths:
  - "**/*.ts"
title: "HTTP API — Node/TypeScript (Fastify)"
---

Opinionated default for a Node/TypeScript HTTP API: **Fastify** with its JSON-Schema-first validation and `@fastify/swagger` for OpenAPI. The OpenAPI document is the contract the frontend generates its client from — it is not optional.

> This is the **backend** TS profile — distinct from `portal-flat` (the React frontend). Add `api` + `backend` for a Node service; add `portal-flat` for the SPA.

## Stack

- **Fastify** — routing, lifecycle hooks, plugins (`@fastify/helmet`, `@fastify/cors`, rate-limit).
- **Schema-first**: every route declares a `schema` (body/params/querystring/response). Fastify validates and serializes from it — no ad-hoc `if (!body.x)` checks.
- Type the schemas with **TypeBox** (or Zod via a type provider) so the handler types are inferred from the schema, not duplicated.
- **@fastify/swagger** (+ swagger-ui in non-prod) emits OpenAPI from those same schemas.

## Rules

- No route without a `schema` — validation, serialization, and OpenAPI all derive from it. A raw handler skipping the schema is a bug.
- Handlers stay thin: parse → call a service/use-case → return its result. Business logic lives behind the boundary, not in the route. **Default to passthrough:** the response `schema` describes the type your service returns directly — do not build a separate DTO object that duplicates it field-for-field. With a generated, type-checked client, a domain rename that ripples to the wire is a compile error in the same build, not a contract to insulate by hand.
- **Introduce a distinct response DTO only when the wire must diverge from that returned type**, for one concrete reason: (1) a field must not reach the wire (secrets, internal flags) — a hard security boundary; (2) a deprecated shape must be held through a data-migration window; (3) the wire has consumers that do not recompile in lockstep (public API, third-party, separately-shipped mobile). Absent one of these, the DTO is ceremony. When you do map, keep it trivial, never a field-by-field copy that can silently drop a field.
- **Leak is deny-by-default.** Because passthrough is the default, the moment a returned type gains a field that must not be public, narrow the response `schema` (or split a DTO) **in the same change** — never let a field reach the wire by accretion. The response `schema` is the marker of what is wire-facing: audit its fields on every change.
- Errors map to the shared error contract — see `backend/errors.md` (problem+json). Use a `setErrorHandler` that renders every error in that shape; never leak stack traces.
- Dependencies are registered as Fastify plugins/decorators (`fastify.decorate('users', ...)`) — no module-level singletons reaching across files.
- Version the API under a path prefix (`/api/v1`).

## Shape

```ts
const UserDto = Type.Object({ id: Type.String({ format: 'uuid' }), email: Type.String() })

app.get('/api/v1/users/:id', {
  schema: { params: Type.Object({ id: Type.String() }), response: { 200: UserDto } },
}, async (req) => app.users.byId(req.params.id))
```

## Checklist

- [ ] Every route declares a `schema` (validation + serialization + OpenAPI)
- [ ] Handler types are inferred from schemas, not hand-written twice
- [ ] The response `schema` describes the returned type directly — no separate DTO object duplicating it 1:1
- [ ] A distinct DTO exists only where the wire must diverge (hidden field / deprecation window / non-lockstep consumer)
- [ ] Every response `schema`'s fields were re-audited this change — no internal field leaked by accretion
- [ ] Errors go through a central `setErrorHandler` → problem+json
- [ ] OpenAPI is emitted and reachable by the frontend generator
- [ ] Routes are versioned (`/api/v1`)
