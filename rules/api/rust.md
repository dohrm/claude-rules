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

- Every route is registered through `OpenApiRouter` — a hand-written handler without `#[utoipa::path]` is a bug, not a shortcut. *(Exception: a code generator that owns route registration — then follow that generator's profile, e.g. `cqrs-rust-lib` → the `cqrs` profile.)*
- **Default to passthrough — don't mint a DTO that duplicates the type your service/query already returns.** That type is usually already consumption-shaped: serialize it directly (derive `Serialize` + `ToSchema`) and accept the request/command type directly as input. With a generated, type-checked client, a domain rename that ripples to the wire is a compile error in the same build — not a contract you must insulate by hand. If a code generator owns the HTTP layer and derives the schema from your own types, that is this rule taken to its conclusion — follow that generator's profile.
- **Introduce a distinct wire DTO only when the wire must diverge from that returned type**, for one concrete reason: (1) a field must not reach the wire (secrets, internal flags) — a hard security boundary; (2) a deprecated shape must be held through a data-migration window; (3) the wire has consumers that do not recompile in lockstep (public API, third-party, separately-shipped mobile). Absent one of these, the DTO is ceremony. When you do map, keep it trivial (`From`/`Into`), never a field-by-field copy that can silently drop a field.
- **Leak is deny-by-default.** Because passthrough is the default, the moment a serialized type gains a field that must not be public, split off a DTO **in the same change** — never let a field reach the wire by accretion. The `Serialize`/`ToSchema` derive is the marker that a type is wire-facing: audit its fields on every change.
- Validate input at the edge (e.g. `axum` extractor + `validator`) before it reaches a command.
- Errors map to the shared error contract — see `backend/errors.md` (problem+json). Do not invent per-handler error shapes.
- `State`/DI is injected via `axum::extract::State` holding the app container — no globals, no service locator.
- Version the API under a path prefix (`/api/v1`).

> **When a generator owns the HTTP layer** (e.g. `cqrs-rust-lib` deriving the schema from aggregate/commands), the hand-rolled `#[utoipa::path]` + DTO checks above do not apply — follow the `cqrs` profile. The one invariant that still holds regardless: **no infrastructure or DB type on the wire.**

## Shape

```rust
#[derive(serde::Serialize, utoipa::ToSchema)]
struct UserDto { id: Uuid, email: String }

#[utoipa::path(get, path = "/api/v1/users/{id}", responses((status = 200, body = UserDto)))]
async fn get_user(State(app): State<AppState>, Path(id): Path<Uuid>) -> Result<Json<UserDto>, ApiError> { /* ... */ }

let (router, api) = OpenApiRouter::new().routes(routes!(get_user)).split_for_parts();
```

## Checklist

- [ ] Every hand-written handler carries `#[utoipa::path]` and is mounted via `OpenApiRouter` (n/a when a generator owns registration — see `cqrs`)
- [ ] The type your service returns is serialized directly; no infra/DB type appears in core or on the wire (the real boundary — not "no domain type on the wire")
- [ ] A DTO exists only where the wire must diverge (hidden field / deprecation window / non-lockstep consumer) — no DTO that duplicates the returned type 1:1
- [ ] Every wire-facing type's fields were re-audited this change — no internal field leaked by accretion
- [ ] Errors go through the shared problem+json contract
- [ ] OpenAPI JSON is served and reachable by the frontend generator
- [ ] Routes are versioned (`/api/v1`)
