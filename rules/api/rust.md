---
paths:
  - "**/*.rs"
title: "HTTP API — Rust (axum + utoipa)"
---

**axum** for routing + **utoipa** for an OpenAPI spec generated from the types.
Passthrough, the DTO reasons, leak, problem+json and versioning: `api/principle.md`.

`just rust-check` owns clippy / test / deny. It does not see a handler without
`#[utoipa::path]`, nor a leaked field on a `ToSchema` type.

## Stack

- **axum** — router, extractors, middleware (`tower`/`tower-http` for the cross-cutting layers).
- **utoipa** — `#[derive(ToSchema)]` on DTOs, `#[utoipa::path(...)]` on handlers; assemble with `OpenApi` derive.
- **utoipa-axum** — `OpenApiRouter` so routes and their OpenAPI metadata are declared in one place, never drift.
- Serve the spec at `/api-docs/openapi.json` — the frontend generator reads it — and, in non-prod, a UI (utoipa-swagger-ui / scalar).

## Rules

- Every route is registered through `OpenApiRouter` — a hand-written handler without `#[utoipa::path]` is a bug, not a shortcut. *(Exception: a code generator that owns route registration — then follow that generator; with event-sourced writes, see the `cqrs` profile.)*
- **The `Serialize` / `ToSchema` derive is the marker that a type is wire-facing.** That is the pair to audit on every change (`api/principle.md` — leak is deny-by-default). When a DTO does earn its place, map with `From`/`Into`.
- Validation at the edge is an `axum` extractor + `validator`, before the value reaches a command.
- `State`/DI is injected via `axum::extract::State` holding the app container — no globals, no service locator.

> **When a generator owns the HTTP layer**, the hand-rolled `#[utoipa::path]` + DTO checks above do not apply — follow the `cqrs` profile.

## Shape

```rust
#[derive(serde::Serialize, utoipa::ToSchema)]
struct UserDto { id: Uuid, email: String }

#[utoipa::path(get, path = "/api/v1/users/{id}", responses((status = 200, body = UserDto)))]
async fn get_user(State(app): State<AppState>, Path(id): Path<Uuid>) -> Result<Json<UserDto>, ApiError> { /* ... */ }

let (router, api) = OpenApiRouter::new().routes(routes!(get_user)).split_for_parts();
```
