---
paths:
  - "**/*.rs"
title: "HTTP API — Rust (axum + utoipa)"
---

Opinionated default for a Rust HTTP API: **axum** for routing + **utoipa** for an OpenAPI spec generated from the types. The OpenAPI document is the contract the frontend generates its client from — it is not optional.

## Stack

- **axum** — router, extractors, middleware (`tower`/`tower-http` for the cross-cutting layers).
- **utoipa** — `#[derive(ToSchema)]` on DTOs, `#[utoipa::path(...)]` on handlers; assemble with `OpenApi` derive.
- **utoipa-axum** — `OpenApiRouter` so routes and their OpenAPI metadata are declared in one place, never drift.
- Serve the spec (`/api-docs/openapi.json`) and, in non-prod, a UI (utoipa-swagger-ui / scalar).

## Rules

- Every route is registered through `OpenApiRouter` — a handler without `#[utoipa::path]` is a bug, not a shortcut.
- Request/response bodies are explicit DTO structs deriving `ToSchema` — never serialize domain aggregates directly onto the wire (keep the hexagonal boundary; DTOs live in the web/adapter layer).
- Validate input at the edge (e.g. `axum` extractor + `validator`) before it reaches a command.
- Errors map to the shared error contract — see `backend/errors.md` (problem+json). Do not invent per-handler error shapes.
- `State`/DI is injected via `axum::extract::State` holding the app container — no globals, no service locator.
- Version the API under a path prefix (`/api/v1`).

## Shape

```rust
#[derive(serde::Serialize, utoipa::ToSchema)]
struct UserDto { id: Uuid, email: String }

#[utoipa::path(get, path = "/api/v1/users/{id}", responses((status = 200, body = UserDto)))]
async fn get_user(State(app): State<AppState>, Path(id): Path<Uuid>) -> Result<Json<UserDto>, ApiError> { /* ... */ }

let (router, api) = OpenApiRouter::new().routes(routes!(get_user)).split_for_parts();
```

## Checklist

- [ ] Every handler carries `#[utoipa::path]` and is mounted via `OpenApiRouter`
- [ ] Wire DTOs derive `ToSchema`; no domain type is serialized directly
- [ ] Errors go through the shared problem+json contract
- [ ] OpenAPI JSON is served and reachable by the frontend generator
- [ ] Routes are versioned (`/api/v1`)
