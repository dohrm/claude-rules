---
paths:
  - "**/migrations/**"
  - "**/migrate/**"
  - "**/*migration*"
title: "Ops — Schema Migrations"
---

A migration is a contract with the version of the code that is *still running*
(`testing/contract.md`). Two versions always run at once during a deploy and the
database is shared between them. Every rule below follows from that one fact.

## Expand, backfill, migrate, contract

Never change a column's meaning in place. Four steps, each deployable on its own:

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
  against the new one. That pair is what makes a rollback survivable — and it is why
  a rollback never has to reverse a data migration (`ops/delivery.md`).
