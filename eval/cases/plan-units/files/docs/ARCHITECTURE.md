# Architecture — Parcel tracking

## Shape & profiles

- **Shape**: backend
- **Installed profiles**: `go testing cicd ops hexagonal api backend`

## Technology stack

| Layer | Choice | Why (1 line) | ADR |
|-------|--------|--------------|-----|
| Language / runtime | Go | the team runs two Go services | ADR-0001 |
| Data store | PostgreSQL | operated by the platform team already | ADR-0002 |
| Ingest contract | append-only scan events | handhelds ship quarterly, the contract cannot move | ADR-0003 |

## Decision log

- [ADR-0001](./adr/0001-go-service.md) — Go for the service
- [ADR-0002](./adr/0002-postgresql.md) — PostgreSQL as the single store
- [ADR-0003](./adr/0003-append-only-ingest.md) — an append-only, idempotent ingest contract
