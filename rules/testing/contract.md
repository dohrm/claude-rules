---
paths:
  - "**/*.rs"
  - "**/*.go"
  - "**/*.py"
  - "**/*.ts"
  - "**/*.tsx"
title: "Testing — Contracts Between Services"
---

Unit tests prove each side is self-consistent; they say nothing about whether the
two sides still agree. That agreement is the **contract**, and it needs its own
test — otherwise a renamed field ships green and breaks at runtime.

## The OpenAPI document is the contract

The `api` profile emits it from the types (utoipa / Huma / Fastify schemas), and
`portal-flat` generates the client from it. That makes the spec a build artifact
on one side and an input on the other — so it must be **committed and gated**:

- **Commit the emitted spec** (e.g. `docs/openapi.json`) and add a gate that
  regenerates it and fails on a diff. Same doctrine as a lockfile: the artifact is
  reviewed with the change that caused it, so a breaking rename is visible in the
  PR instead of at integration time.
- **The consumer never hand-writes a request or response type.** Anything typed by
  hand next to `src/api/generated/` is drift waiting to happen. The exceptions are
  the things genuinely absent from the spec (URL search params, form state) — those
  carry their own hand-written schema and say so.
- **CI wires the two ends**: the backend job publishes the spec as an artifact, the
  frontend job regenerates against it (`generate:api:file`) and fails on a diff or
  a type error. A frontend that only ever builds against a stale committed client
  is not testing the contract.

## Breaking changes are a versioning decision, not a test failure

A contract test tells you the shape moved; it does not tell you whether that was
allowed. Removing a field, tightening a type, or adding a required request field
is **breaking** — it needs a deprecation window (add the new field, keep the old
one serving, migrate consumers, then remove) or an explicit version bump recorded
as a decision (see `agent/decisions.md`). Widening a type or adding an optional
field is additive and needs none of that.

## Other contracts

The same rule applies anywhere two deployables agree on a shape:

- **Messages/events** — the published schema is committed and gated the same way.
  Consumers tolerate unknown fields (parse permissively, validate what they use)
  so a producer can add a field without a lockstep deploy.
- **Database schema** — the migration is the contract with the *previous* version
  of the code, which is still running during a rollout. Test that the new code
  works against the old schema and the old code against the new one, or the deploy
  is a coin flip.
- **Third parties** — record real responses as fixtures and replay them; add a
  scheduled job that hits the live sandbox so a silent upstream change surfaces on
  its own schedule instead of during an incident.

## Per-language note

- **Rust** — a test that builds the `utoipa::OpenApi` doc and compares it to the
  committed file (`insta` snapshot or a plain string diff).
- **Go** — a test that serves the Huma spec and diffs it against the committed
  `openapi.json`.
- **Node** — `fastify.swagger()` in a test, diffed against the committed spec.
- **Frontend** — regenerate with `generate:api:file` in CI and fail on a non-empty
  `git diff` under `src/api/generated`.

## Checklist

- [ ] The emitted OpenAPI spec is committed and a gate fails on an undeclared diff
- [ ] The consumer's client is generated, never hand-written
- [ ] CI regenerates the client against the producer's fresh spec
- [ ] Breaking shape changes carry a deprecation window or a recorded decision
- [ ] Event consumers tolerate unknown fields
- [ ] Migrations are tested against both the old and the new code
