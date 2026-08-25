---
paths:
  - "**/*.rs"
title: "Hexagonal Architecture — Rust"
---

Port/adapter patterns, leaky-abstraction checks, and the inward-only cut:
`hexagonal/principle.md`. This file is the Rust crate surface only.

## Allowed dependencies in core

- `serde` — serialization traits and derive macros only (format-agnostic)
- `thiserror` — typed error definitions
- `async-trait` — async port definitions
- `uuid`, `chrono` — value objects
- `http` — HTTP types as pure value objects (`StatusCode`, `Uri`, `HeaderMap`…) — **not** as a client

If a `#[derive]` needs a wire-only crate (e.g. `utoipa::ToSchema`), gate it behind an optional Cargo feature on the core crate; enable that feature from the adapter or entrypoint that owns OpenAPI — never pull it into core's default deps.

## Forbidden in core

- `serde_json`, `serde_bson`, `quick-xml` — format-specific serialization (belongs in infra). `serde_json::Value` as a domain field is the same default: typed shape, not an untyped blob. An opaque JSON document as a real domain concept is an ADR, not a convenience escape.
- `mongodb`, `sqlx`, `diesel` — database drivers
- `axum`, `actix`, `rocket` — web frameworks
- `reqwest`, `hyper` — HTTP clients
- `jsonwebtoken`, `openidconnect` — auth implementations
- `anyhow` — not allowed in port (trait) signatures

## Cargo.toml Checklist

- [ ] Core crate has no infra dependencies
- [ ] No `use mongodb::` / `use axum::` / `use sqlx::` / `use reqwest::` in core
- [ ] Port signatures use typed errors (`thiserror`), not `anyhow` or `Box<dyn Error>`
