---
paths:
  - "**/*.rs"
  - "**/*.go"
  - "**/*.py"
  - "**/*.ts"
title: "CQRS / Event Sourcing"
---

Write and read are different jobs. A command changes state; a query does not.
Event sourcing makes the event log the source of truth — read models are
derived, never written by hand. This profile is the **pattern**, not a library.
Pick the crate or package that fits the repo; do not import one because a
rule named it.

## SOLID, applied here

Vocabulary, not a scorecard. Do not add a command type, a port, or a
projection to "be SOLID".

- **S** — a command handler does not answer queries; a projection does not
  validate writes. That is the split. Do not extract a type per field of a
  command.
- **O** — a new capability is a new command and new events, not an edit of
  persisted events (they are immutable). Skip a new port when one store
  still serves both sides honestly.
- **L** — a projection honours the events it claims to fold. A "faster"
  view that drops a guarantee the reader relies on is not a substitute.
- **I** — one command type per operation, not a god-command with optional
  flags for every write. Do not split a command the caller always sends
  together.
- **D** — domain query structs are plain data; infrastructure translates
  them. The aggregate does not import a database type.

## Write Flow

```
Command → Command Handler → Aggregate validates → Events emitted → Events persisted
```

## Read Flow

```
Events → Event Handlers → Projections / Read Models → Query → Response
```

Read models are derived **exclusively from events**. They are never written to directly.

## Core Concepts

- **Command**: intent to change state — rejected if invalid, no event emitted
- **Aggregate**: consistency boundary — validates commands, emits events, applies state
- **Event**: immutable fact about what happened — the source of truth
- **Event Store**: append-only log of events — never modified or deleted
- **Projection / Read Model**: a view derived from replaying events — optimized for query

## Core Rules

- **Events are immutable** — never modify or delete persisted events
- **State changes go through commands** — no direct mutation of aggregate state
- **Read models derived from events only** — via event handlers, never written directly
- **Commands can be rejected** — a rejected command produces no event and no state change
- **Port signatures use typed errors** — no opaque error boxes in domain interfaces

## Domain Layer

- Aggregate: validates commands, emits events, holds current state (rebuilt by applying events)
- Commands: express intent — one command type per operation
- Events: facts — named in past tense (`UserCreated`, `OrderShipped`)
- Query structs: plain data describing read-side filter parameters — no DB knowledge

## Infrastructure Layer

- Event store: append-only persistence of events
- Snapshot store *(optional optimization)*: cached aggregate state to avoid full event replay — not a primary read model
- Projections: listen to events, maintain read-optimized views
- Query translation: maps domain query structs to DB-specific queries

Identity for audit (who issued the command) is extracted at the entry
point and threaded in. The domain does not mint that context ad-hoc.

## Denormalized Views

Additional read models derived from events for specific query shapes the aggregate state does not serve well (e.g. per-event history, cross-aggregate summaries).

```
Event persisted → Event handler triggered → View updated
```

### View Rules

- A view defines how to fold a single event into its state — irrelevant events are ignored
- That fold is **pure** — no I/O, no side-effects; infrastructure persists the result
- Views are read-only from the domain perspective — only event handlers write to them
- One view record per event (history/child) or one per aggregate (summary) — depends on the shape
- View storage lives in the infrastructure layer

## HTTP (when `api` is also installed)

Hand-written routes follow `api/*`: OpenAPI on the handler, no infra type
on the wire. If a **generator** owns registration and derives the spec
from commands / read models, follow that generator — do not hand-roll a
1:1 DTO layer to satisfy `api` literally. The invariant that still
holds: **no I/O, no client, no DB type in core or on the wire.**
Serialization *traits* in domain (the same pragmatic exception as
`hexagonal`) are acceptable; format-specific codecs stay in
infrastructure. Record a generator-owns-HTTP choice in an ADR so it is
not re-litigated as a bug.

## Checklist

- [ ] State changes go through commands → aggregate → events
- [ ] Events persisted before any read model is updated
- [ ] Read models updated via event handlers only — never written directly
- [ ] Snapshots, if present, are an optimization — not the primary read model
- [ ] Query structs have no DB mapping logic
- [ ] Rejected commands produce no events
