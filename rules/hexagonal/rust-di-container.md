---
paths:
  - "**/*.rs"
title: "Dependency Injection — Rust"
---

Composition root only — wiring, not domain. No globals, no service locator.
`AppState` holds adapters and ports; handlers take `State<AppState>`.

## Small app — flat `AppState`

One struct, every direct dep as a constructor arg. Prefer this until a second
module appears.

```rust
pub struct AppState {
    pub users: Arc<dyn UserRepository>,
    pub mail: Arc<dyn Mailer>,
}

impl AppState {
    pub async fn new(config: &Config) -> Result<Self> {
        let db = Database::connect(&config.database_url).await?;
        Ok(Self {
            users: Arc::new(PgUserRepository::new(db.clone())),
            mail: Arc::new(SmtpMailer::new(&config.smtp)?),
        })
    }

    pub fn router(self) -> Router {
        Router::new()
            .route("/api/v1/users/{id}", get(get_user))
            .with_state(self)
    }
}
```

Eager for anything that should fail at boot (DB, required clients). Optional
infra is `Option<_>` — degrade, do not panic later.

## Lazy — `tokio::sync::OnceCell`

Connection pools, compiled assets, clients a route may never touch: pay the cost
on first use, not in `new()`. `OnceCell` runs the init closure once; concurrent
callers await the same future.

```rust
use tokio::sync::OnceCell;

pub struct ReportsContainer {
    db: Database,
    compiler: OnceCell<Arc<ReportCompiler>>,
}

impl ReportsContainer {
    pub fn new(db: Database) -> Self {
        Self { db, compiler: OnceCell::new() }
    }

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

Split only when the flat struct becomes a bag of unrelated fields. One
container per module; `AppState` composes them; **one** registry lists routes.

```rust
pub struct UsersContainer {
    services: Arc<UsersServices>,
}

impl UsersContainer {
    pub async fn new(db: Database) -> Result<Self> { /* wire adapters */ }
    pub fn services(&self) -> &Arc<UsersServices> { &self.services }
    pub fn routes(&self) -> Router<AppState> { /* users routes only */ }
}

pub struct AppState {
    pub users: UsersContainer,
    pub billing: BillingContainer,
}

impl AppState {
    pub async fn new(config: &Config) -> Result<Self> {
        let db = Database::connect(&config.database_url).await?;
        let users = UsersContainer::new(db.clone()).await?;
        let billing = BillingContainer::new(db, users.services().clone()).await?;
        Ok(Self { users, billing })
    }

    pub fn router(self) -> Router {
        Router::new()
            .merge(self.users.routes())
            .merge(self.billing.routes())
            .with_state(self)
    }
}
```

Cross-module callbacks after construction (if needed) consume `self` so they
cannot register twice.

## Rules

- `new(...)` — all direct dependencies explicit
- No business logic in `AppState` or a module container — wiring only
- Route (or handler) registration has one home; adding a module is one line there
