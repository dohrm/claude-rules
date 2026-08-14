# Changelog

What changed for a repo that **installs** these assets — not a record of the work.
Newest first, grouped by impact, breaking changes and their migration first.

> This file starts with the entries below. Nothing before them was ever tagged, so
> there is no release to reconstruct; that history lives in the git log.

**Versioning.** SemVer on the *asset contract*: an installed rule, skill, kit file or
CLI flag a consuming repo depends on. **We are on `0.x`, where MINOR is the breaking
slot** — pin a ref (`--ref <tag>`) if you need the guarantee `0.x` does not give.

## [Unreleased]

### Changed

- **BREAKING — `/loop-setup` keeps its state in one file under `.work/`.** It used to
  write `PLAN.md` and `MEMORY.md` at the repo root; it now writes a single
  `.work/loop.md` (bounded objective, guardrails, remaining work, log, escalations).
  The old name collided head-on with the durable `docs/PLAN.md` that `/plan` owns —
  two files, one name, opposite lifetimes: one is a promise kept for the life of the
  project, the other is scaffolding that dies with the branch.

  **Migration** — only if a loop is in flight. Nothing breaks silently: the skill
  simply will not find the old files, and a restarted loop would begin with an empty
  log, losing the dead ends it must not retry.

  1. Create `.work/loop.md` from the skill's template.
  2. Move `PLAN.md`'s checklist under `## Remaining work`, `MEMORY.md`'s entries under
     `## Log`, and anything that was waiting on you under `## Blocked on the human`.
  3. Delete the two old files and add `.work/` to `.gitignore`.

  With no loop running, delete the two files and move on.

### Added

- **`/tasks`** (profile `product`) — the missing step between a plan and code. It takes
  **one** phase of `docs/PLAN.md` and cuts it into tasks an agent loop can execute:
  the anchors in your existing code (where each layer attaches, and the nearest
  neighbour to imitate), a first task that freezes the phase's contract **as code**,
  then tasks sized to the *green boundary* — the smallest change that leaves the gate
  green, which is what makes one-commit-per-task true and the branch bisectable.

  Output is `.work/phase-NN-<slug>.md`: gitignored working memory, never a document
  under `docs/`. The phase's promise stays in `docs/plan/`, the account of what
  happened is the git log. Run it when a phase *starts*, not once for every phase —
  the code will have moved.

  `/loop-setup` composes with it: given a phase worklist it adds only its guardrails
  section to that file rather than writing a second plan.
