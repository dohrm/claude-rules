---
paths:
  - "**/*.rs"
  - "**/*.go"
  - "**/*.ts"
  - "**/*.tsx"
  - "**/migrations/**"
title: "Ops — Delivery, Migrations & Rollback"
---

Two versions of the code always run at once during a deploy, and the database is
shared between them. Every rule below follows from that one fact.

## Deploying is not releasing

- **Deploy** puts a version on a machine. **Release** exposes behavior to users.
  Coupling them makes every deploy a risk and every rollback a rebuild.
- Decouple with a flag: ship the code dark, turn it on separately, turn it off without
  a deploy.
- The artifact deployed is the one CI built and tested — built once, promoted across
  environments (`cicd/pipeline.md`); configuration is injected at run time
  (`backend/config.md`).

## Schema migrations — expand, migrate, contract

A migration is a contract with the version of the code that is *still running*
(`testing/contract.md`). Never change a column's meaning in place. Four steps, each
deployable on its own:

1. **Expand** — add the new column/table, nullable or defaulted. Old code ignores it.
2. **Backfill** — populate in bounded batches, restartable, idempotent. Never one
   transaction over a large table.
3. **Migrate the readers/writers** — new code writes both, reads the new. Old code
   still works.
4. **Contract** — once no running version needs it, drop the old column. A separate
   deploy, later, and never in the same release as step 3.

Rules that make it hold:

- **Every migration is forward-only and idempotent.** "Down" migrations are a fiction
  in production: the rollback path is a *new* forward migration.
- **Additive first**: a rename is an add + backfill + drop, never a rename.
- **No long lock.** Adding an index is concurrent; adding a `NOT NULL` is a default
  plus a later constraint validation. A migration that locks a hot table is an
  outage you scheduled.
- **The migration runs separately from the app boot.** An app that migrates on
  startup, with N replicas, races itself.
- **Test both directions of the seam**: new code against the old schema, old code
  against the new one. That pair is what makes a rollback survivable.

## Rollback

- **One command, and it is rehearsed.** A rollback path that has never been executed
  is a hypothesis.
- **A rollback must not require reversing a data migration.** If it does, it is not a
  rollback — that is what expand/contract buys you.
- **Roll back first, diagnose after.** Restoring service is not the same activity as
  finding the cause, and doing them in the wrong order costs the error budget.
- Rolling back a *release* is flipping the flag; rolling back a *deploy* is promoting
  the previous artifact. Know which one the situation needs.

## Progressive rollout

- Canary → a percentage → everything, each step **gated on the SLI**
  (`ops/slo.md`), not on elapsed time.
- **Automatic rollback on burn**: if the canary burns error budget faster than the
  threshold, it is withdrawn without a human in the loop. Humans are for deciding
  what to do next, not for watching a graph.
- Zero-downtime needs the whole chain: readiness flipped before shutdown, in-flight
  requests drained under a bounded timeout (`backend/health.md`), and an API that is
  backward compatible for the length of the rollout (`cicd/release.md`).

## Feature flags are debt with a due date

- **Every flag has an owner and a removal date**, in the code, at the definition.
- **Two kinds, never mixed**: a *kill switch* (long-lived, operational, off means
  degraded but working) and a *rollout/experiment flag* (short-lived, removed after
  the rollout).
- **A flag is a branch in production** — both sides must be tested, and the flagged
  path must not accumulate business rules that only exist on one side.
- Flags outliving their date are a review blocker. Ten stale flags are 1024
  configurations nobody has tested.

## Checklist

- [ ] Deploy and release are separable; the artifact is promoted, never rebuilt
- [ ] Every schema change follows expand → backfill → migrate → contract, in separate deploys
- [ ] Migrations are forward-only, idempotent, batched, lock-free on hot tables
- [ ] Migrations run as their own step, not at app boot
- [ ] Old code tested against the new schema, and the reverse
- [ ] Rollback is one rehearsed command and needs no data reversal
- [ ] Rollout steps gate on the SLI, with automatic withdrawal on burn
- [ ] Every flag has an owner, a kind and a removal date
