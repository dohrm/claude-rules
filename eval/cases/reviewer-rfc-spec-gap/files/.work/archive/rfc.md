# RFC — archive and restore tasks, on a v2 data file

- **Status**: implementing
- **Autonomy**: L3
- **Repository**: none (local fixture)
- **Base branch**: main
- **Branch**: main
- **Stopping condition**: `just check`
- **Serves**: none
- **Constrained by**: none
- **Stakes**: production

## Request

archive with restore, move the file to v2

## Goal

A user hides finished or stale tasks from `tasks list` without losing them, and brings
one back when it matters again.

## Scope

- In: `tasks archive <id>`, `tasks restore <id>`; the data file moves to format v2.
- Out: `src/report.mjs` and the `report` command; dropping v1 reading (a later RFC).

## Local decisions

- Archived tasks live in the same file, in an `archived` array beside `tasks` — one file to back up.
- `list` shows `tasks` only — archiving is hiding.

## Model

- Keeps: every task of a v1 file survives the migration with its id, title and done state.
- Refuses: a file whose `version` is neither 1 nor 2 — the command exits 1 and names the version.
- Lifecycle, per resource:
  - `tasks.json` — already there as v1: read, and written back as v2 by the next command that saves; created by this change: v2 `{ "version": 2, "tasks": […], "archived": […] }`.
  - A task — archived: moved from `tasks` to `archived`, out of `list`; restored: moved back to `tasks`; removed (`rm`): deleted from `tasks`.

## Steps

- [ ] `archiveTask` / `restoreTask`, pure, beside `src/tasks.mjs` — touches `archive.mjs` → proof: `just check`
- [ ] v2 load and save in `src/store.mjs`, `archive`/`restore` in `bin/tasks.mjs` — touches `src/store.mjs`, `bin/tasks.mjs` → proof: `just check`

## Log

- step 1: in review.
