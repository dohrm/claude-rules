---
paths:
  - "**/*.rs"
title: "CQRS / Event Sourcing — Rust"
---

## Library

[`cqrs-rust-lib`](https://github.com/dohrm/cqrs-rust-lib)

## Opinionated Deviations from Pure CQRS-ES

| Pure CQRS-ES | This implementation |
|---|---|
| Snapshot = optional optimization | Snapshot = primary read model, written on every command |
| One command type per operation | `CreateCommand` + `UpdateCommand` per aggregate |
| Views updated after event persistence | `ViewDispatcher` fires after (event + snapshot) pair |
| No prescribed query layering | Query in domain + `QueryBuilder` in infrastructure |

## Aggregate Pattern

```rust
impl Aggregate for User {
    const TYPE: &'static str = "users";
    type CreateCommand = CreateUserCommands;
    type UpdateCommand = UpdateUserCommands;
    type Event = UserEvents;
    type Services = Arc<dyn UserServices + Send + Sync>;
    type Error = UserError;

    async fn handle_create(cmd: Self::CreateCommand, svc: &Self::Services) -> Result<Vec<Self::Event>, Self::Error>;
    async fn handle_update(&self, cmd: Self::UpdateCommand, svc: &Self::Services) -> Result<Vec<Self::Event>, Self::Error>;
    fn apply(&mut self, event: Self::Event) -> Result<(), Self::Error>;
}
```

## Query / QueryBuilder Split

`UserQuery` — plain data, no DB knowledge — lives in domain.
`UserQueryBuilder` — translates `UserQuery` to a DB `Document` — lives in infrastructure.

## CqrsContext

Carries user identity for audit trails. Extracted in HTTP middleware, threaded through all commands.

## ViewDispatcher

`ViewDispatcher<A, V, Q>` fires after (event + snapshot) pair is persisted.

```rust
impl View<Account> for Movement {
    const TYPE: &'static str = "movement";
    const IS_CHILD_OF_AGGREGATE: bool = true; // true = one record/event; false = one record/aggregate

    fn view_id(event: &EventEnvelope<Account>) -> String;
    fn update(&self, event: &EventEnvelope<Account>) -> Option<Self>; // None = ignore this event
}
```

`update()` must be pure — no I/O, no side-effects.

## HTTP exposure (with the `api` profile)

`cqrs-rust-lib` makes the aggregate and commands the **typed HTTP contract**: it registers the operations and derives the OpenAPI schema from `Create*`/`Update*` commands and the snapshot (the primary read model). So `utoipa::ToSchema` (and `serde`) land in the **domain crate**, and there is no hand-written `#[utoipa::path]` handler or separate DTO layer. On paper this deviates from two profiles:

- `api/rust` — "DTOs in the web layer; a hand-written handler without `#[utoipa::path]` is a bug". Here the generator owns both.
- `hexagonal` — "no infra deps in core". Here `utoipa` appears in core.

Accept it, don't fight it. The load-bearing invariant is unchanged: **no I/O, no client, no DB type in core or on the wire.** `ToSchema` only *describes* a schema — same category as the `serde` derives already tolerated in core, one notch more format-aware; query→DB mapping stays in the `QueryBuilder`. Hand-rolling a DTO + `#[utoipa::path]` layer to satisfy the profiles literally would fight the `/rust-add-domain` scaffold and duplicate every read model 1:1 for no invariant gained.

Record each repo's exercise of this in an **ADR** — the impurity is a dated decision, not an oversight, so `utoipa`-in-core is never re-flagged as a bug on later review.

## Rules

- `Aggregate` + `View` structs in domain crate — no infra imports, **except** the `serde`/`utoipa::ToSchema` derives that make them the HTTP contract (see HTTP exposure; recorded in an ADR)
- `QueryBuilder` + `ViewDispatcher` wiring in infrastructure crate
- Events persisted via engine — no direct snapshot mutation
- `CqrsContext` propagated from entry point, never created ad-hoc in domain
