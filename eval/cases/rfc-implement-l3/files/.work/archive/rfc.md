# RFC — archive and restore tasks, on a v2 data file

- **Status**: ready
- **Autonomy**: L3
- **Repository**: none (local fixture, no remote)
- **Base branch**: main
- **Branch**: <set at implementation>
- **Stopping condition**: `just check`
- **Serves**: none
- **Constrained by**: none
- **Stakes**: production

## Request

archive with restore, move the file to v2

## Goal

A user hides stale tasks from `tasks list` without losing them, and brings one back
when it matters again. Their existing v1 file keeps working.

## Scope

- In: `tasks archive <id>`, `tasks restore <id>`, `tasks list --archived`; the data file
  moves to format v2, and a v1 file is still read.
- Out: `src/report.mjs` and the `report` command (it keeps counting every task); dropping
  v1 reading (a later RFC, after a migration hold); the `justfile`.

## Local decisions

- v2 is `{ "version": 2, "nextId": <n>, "tasks": [ { "id", "title", "done", "archived" } ] }` — archived tasks stay in `tasks` with a flag: one list, one id space.
- `tasks list` shows the tasks not archived; `tasks list --archived` shows only the archived ones — archiving is hiding.
- `archive` on an archived task, `restore` on one that is not, and either on an unknown id exit 1 with a message — the CLI's existing "refused" code.
- `done` and `rm` act on any task, archived or not — unchanged commands.

## Model

- Keeps: an id names one task forever. `add` takes `nextId` and increments it; nothing
  lowers it — not `rm`, not `archive`.
- Keeps: every task of a v1 file survives with its id, title and done state, and is not archived.
- Refuses: a file whose `version` is neither 1 nor 2 — exit 1, the message names the version.
- Refuses: a v2 file whose `nextId` is not above every id in it — exit 1: it would hand out an id twice.
- Lifecycle, per resource:
  - `tasks.json` — created by this change: v2. Already there as v1: read by every command,
    `nextId` = one past its highest id; written back as v2 by the next command that saves.
    `list` never writes.
  - A task — archived and restored: keeps its id. Removed (`rm`): its id is never handed
    out again. Reused after removal: refused — `nextId` only grows.

## Steps

- [ ] `src/store.mjs`: read v1 and v2, write v2, the two refusals — touches `src/store.mjs`, `test/` → proof: `just check`
- [ ] `src/tasks.mjs`: `addTask` from `nextId`, `archiveTask`, `restoreTask` — touches `src/tasks.mjs`, `test/` → proof: `just check`
- [ ] `bin/tasks.mjs`: `archive`, `restore`, `list --archived` — touches `bin/tasks.mjs`, `test/` → proof: `just check`

## Open questions

- none
