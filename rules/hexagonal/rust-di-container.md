---
paths:
  - "**/*.rs"
title: "Dependency Injection — Rust"
---

Composition root only — wiring, not domain. No globals, no service locator.
`AppState` holds adapters and ports; handlers take `State<AppState>`.

## Small app — flat `AppState`

One struct, every direct dependency as a constructor arg (`Arc<dyn UserRepository>`,
`Arc<dyn Mailer>`). `AppState::new(&Config)` connects and builds each adapter;
`router()` mounts the routes `.with_state(self)`. Prefer this until a second module
appears.

Eager for anything that should fail at boot (DB, required clients). Optional
infra is `Option<_>` — degrade, do not panic later.

## Lazy — `tokio::sync::OnceCell`

Connection pools, compiled assets, clients a route may never touch: pay the cost
on first use, not in `new()`. `OnceCell` runs the init closure once; concurrent
callers await the same future.

```rust
pub struct ReportsContainer {
    db: Database,
    compiler: OnceCell<Arc<ReportCompiler>>,
}

impl ReportsContainer {
    pub async fn compiler(&self) -> Result<&Arc<ReportCompiler>> {
        self.compiler
            .get_or_try_init(|| async {
                ReportCompiler::connect(&self.db).await.map(Arc::new)
            })
            .await
    }
}
```

Handlers call `container.compiler().await?` — boot stays cheap; the first call
pays connect and later calls reuse the cell. Still wiring-only: no business
logic inside the init closure beyond constructing the adapter.

## When it grows — module containers

Split only when the flat struct becomes a bag of unrelated fields. One container per
module, each exposing `services()` and `routes() -> Router<AppState>`. `AppState`
holds one field per container, and its `new` threads shared dependencies between
them (`BillingContainer::new(db, users.services().clone())`). **One** registry lists
routes — `AppState::router()` merges each container's.

Cross-module callbacks after construction (if needed) consume `self` so they
cannot register twice.

## Rules

- `new(...)` — all direct dependencies explicit
- No business logic in `AppState` or a module container — wiring only
- Route (or handler) registration has one home; adding a module is one line there
