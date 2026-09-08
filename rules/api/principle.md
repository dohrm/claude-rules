---
paths:
  - "**/*.rs"
  - "**/*.go"
  - "**/*.py"
  - "**/*.ts"
title: "HTTP API — Shared Principles"
---

What every `api/*` profile agrees on, stated once so two agents in two languages
cannot reach two different answers about the same DTO. Stack and mechanism are
per-language (`api/rust.md`, `api/go.md`, `api/python.md`, `api/node.md`).

## The OpenAPI document is the contract

Generated from the types, never hand-written; the frontend generates its client from
it and `testing/contract.md` gates the round trip. Serve it, commit the emitted file.
It is the interface, not documentation that lags the code.

## Default to passthrough

**Don't mint a DTO that duplicates the type your service or query already returns** —
serialize that type directly, and take the request/command type directly as input.
With a generated, type-checked client, a domain rename that reaches the wire is a
compile error in the same build, not a contract to insulate by hand.

## A wire DTO needs one of three reasons

Introduce one **only when the wire must diverge** from that returned type:

1. **a field must not reach the wire** (secrets, internal flags) — a hard security boundary;
2. **a deprecated shape must be held** through a data-migration window (`ops/migrations.md`);
3. **consumers do not recompile in lockstep** — public API, third party, separately-shipped mobile.

Absent one of these, the DTO is ceremony. When you do map, **keep it trivial** —
never a field-by-field copy that can silently drop a field.

## Leak is deny-by-default

The moment a serialized type gains a field that must not be public, split off a DTO
**in the same change** — never let a field reach the wire by accretion. Each language
names its own "wire-facing" marker (a derive, a struct tag, a response schema);
re-auditing that marker's fields is part of every change touching it.

The real boundary is **no infrastructure or DB type on the wire** — not "no domain
type on the wire".

## Rules

- **Validate at the edge**, once, through the framework's own mechanism.
- **Errors map to problem+json** (`backend/errors.md`). No per-handler error shapes.
- **Dependencies come from one composition root** — no globals, no service locator.
- **Version under a path prefix** (`/api/v1`).
- **When a generator owns the HTTP layer** — deriving the spec from aggregates,
  commands or read models — follow the generator rather than hand-rolling a 1:1 DTO
  layer to satisfy this rule literally, and record the choice in an ADR
  (`agent/decisions.md`). The wire invariant still holds.
