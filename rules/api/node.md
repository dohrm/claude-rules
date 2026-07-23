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
- Handlers stay thin: parse → call a service/use-case → map to the response DTO. Business logic lives behind the boundary, not in the route.
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
- [ ] Errors go through a central `setErrorHandler` → problem+json
- [ ] OpenAPI is emitted and reachable by the frontend generator
- [ ] Routes are versioned (`/api/v1`)
