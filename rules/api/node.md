---
paths:
  - "**/*.ts"
title: "HTTP API — Node/TypeScript (Fastify)"
---

**Fastify** with its JSON-Schema-first validation and `@fastify/swagger` for
OpenAPI. Passthrough, the DTO reasons, leak, problem+json and versioning:
`api/principle.md`.

`just ts-node-check` owns eslint / tsc / vitest. It does not see a route
without a `schema`, nor OpenAPI emission.

> This is the **backend** TS profile — distinct from the frontend ones. Add `api` + `backend` for a Node service; add `portal-flat` + `portal-http` for the SPA.

## Stack

- **Fastify** — routing, lifecycle hooks, plugins (`@fastify/helmet`, `@fastify/cors`, rate-limit).
- **Schema-first**: every route declares a `schema` (body/params/querystring/response). Fastify validates and serializes from it.
- Type the schemas with **TypeBox** (or Zod via a type provider) so the handler types are inferred from the schema, not duplicated.
- **@fastify/swagger** (+ swagger-ui in non-prod) emits OpenAPI from those same schemas — that emission is what the frontend generator reads.

## Rules

- No route without a `schema` — validation, serialization, and OpenAPI all derive from it. A raw handler skipping the schema is a bug.
- Handlers stay thin: parse → call a service/use-case → return its result. Business logic lives behind the boundary, not in the route.
- **The response `schema` is the marker of what is wire-facing.** It is what to narrow when a returned type gains a field that must not be public (`api/principle.md` — leak is deny-by-default), and passthrough means it describes the service's type directly.
- Errors go through one `setErrorHandler` that renders every error as problem+json (`backend/errors.md`) — never a leaked stack trace.
- Dependencies are registered as Fastify plugins/decorators (`fastify.decorate('users', ...)`) — no module-level singletons reaching across files.

## Shape

```ts
const UserDto = Type.Object({ id: Type.String({ format: 'uuid' }), email: Type.String() })

app.get('/api/v1/users/:id', {
  schema: { params: Type.Object({ id: Type.String() }), response: { 200: UserDto } },
}, async (req) => app.users.byId(req.params.id))
```
