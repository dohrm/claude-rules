---
paths:
  - "**/*.rs"
  - "**/*.go"
  - "**/*.py"
  - "**/*.ts"
  - "**/*.tsx"
title: "Ops — Releasing, Rollback & Flags"
---

Two versions of the code always run at once during a deploy. Schema changes under
that constraint are `ops/migrations.md`; this rule owns the release itself.

## Deploying is not releasing

- **Deploy** puts a version on a machine. **Release** exposes behavior to users.
  Coupling them makes every deploy a risk and every rollback a rebuild.
- Decouple with a flag: ship the code dark, turn it on separately, turn it off without
  a deploy.
- The artifact deployed is the one CI built and tested — built once, promoted across
  environments (`cicd/pipeline.md`); configuration is injected at run time
  (`backend/config.md`).

## Rollback

- **One command, and it is rehearsed.** A rollback path that has never been executed
  is a hypothesis.
- **A rollback must not require reversing a data migration.** If it does, it is not a
  rollback — that is what expand/contract buys you (`ops/migrations.md`).
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
