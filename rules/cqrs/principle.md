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

Layers, ports, typed errors, and "no DB type in core" stay
`hexagonal/principle.md`. This file owns the write/read split only.

## SOLID, applied here

Use a letter only when it names a cut you already need. The general form is
`hexagonal/principle.md`; two cuts belong to this profile alone.

- **S** — a command handler does not answer queries; a projection does not
  validate writes. That is the split this file owns. Do not extract a type per
  field of a command.
- **I** — one command type per operation, not a god-command with optional
  flags for every write. Do not split a command the caller always sends
  together.

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
- **Event**: immutable fact about what happened — the source of truth; named in past tense (`UserCreated`, `OrderShipped`)
- **Event Store**: append-only log — never modified or deleted (infra)
- **Projection / Read Model**: view derived from replaying events — query-shaped (infra persists; domain defines the fold)

## Core Rules

- **Events are immutable** — never modify or delete persisted events
- **State changes go through commands** — no direct mutation of aggregate state
- **Events are persisted before any read model is updated** — the log is the source
  of truth, the view is derived from it, never alongside it
- **Read models derived from events only** — via event handlers, never written directly
- **Commands can be rejected** — a rejected command produces no event and no state change
- **Snapshots**, if present, are an optimization to skip full replay — not a primary read model

Identity for audit (who issued the command) is extracted at the entry
point and threaded in. The domain does not mint that context ad-hoc.

## Denormalized Views

Additional read models for query shapes the aggregate state does not serve
well (per-event history, cross-aggregate summaries).

```
Event persisted → Event handler triggered → View updated
```

- A view folds a single event into its state — irrelevant events are ignored
- That fold is **pure** — no I/O; infrastructure persists the result
- Views are read-only from the domain — only event handlers write to them
- One record per event (history) or per aggregate (summary) — depends on the shape

## HTTP (when `api` is also installed)

Hand-written routes follow `api/*`. If a **generator** owns registration and
derives the spec from commands / read models, follow that generator — do not
hand-roll a 1:1 DTO layer to satisfy `api` literally. Record the choice in an
ADR. The hexagonal wire invariant still holds: no DB / client type on the wire.
