# Bug — `remove <stack>` leaves the stack's overlays in other profiles (hexagonal/go.md)

- **Status**: diagnosed
- **Autonomy**: L3
- **Repository**: https://github.com/dohrm/claude-rules
- **Base branch**: next
- **Branch**: fix/defect-48
- **Ticket**: https://github.com/dohrm/claude-rules/issues/48

## Symptom

After `add rust go hexagonal` then `remove go`, `.claude/rules/hexagonal/go.md` (and, with
Cursor, `.cursor/rules/hexagonal/go.mdc`) stay on disk and in the lock's `hexagonal`
record, so the Go hexagonal rule keeps loading in a repo with no Go.

## Expected behavior

A rule whose every glob targets a language the repo did not lock is not emitted —
source: `bin/cli.mjs` § `isLanguageDead` ("`api/go.md` has no business in a repo with no
Go"), applied by every emitter at install; `update` on the same lock removes both files
(observed below); `remove()` already applies it to Codex rules (`lock.codex.rules`).

## Reproduction

- Command: `node --test --test-name-pattern "remove <stack>" test/cli.test.mjs` (regression
  test added in phase 4); by hand: `add rust go hexagonal --agent claude,cursor`, `remove go`,
  check `.claude/rules/hexagonal/go.md`.
- Fails on: `baedc1b` — after `remove go`: claude `go.md` present, cursor `go.mdc` present,
  codex `.agents/rules/hexagonal/go.md` absent; the lock's `hexagonal` record still lists
  `.claude/rules/hexagonal/go.md`. After `update`: both absent.

## Hypotheses

1. `remove()` re-filters only Codex rules by `isLanguageDead`; the kept records' Claude and
   Cursor files are kept as they are (`isKept` → `keptInstalled`) — if true: the kept
   `hexagonal` record still lists `go.md` and the Codex copy is gone; if false: the record
   drops it → **confirmed**: record lists `.claude/rules/hexagonal/go.md`, Codex copy
   removed (`bin/cli.mjs` `remove()`, the `isLanguageDead` loop runs over `lock.codex.rules` only).
2. The lock records no globs for Claude/Cursor files, so `remove()` cannot tell a dead rule
   without reading it — if true: an installed record holds only `{path: hash}`; if false: it
   carries `paths` → **confirmed** (contributing): records are `{source, kind, from, to,
   profile, files: {path: hash}}`. The globs must come from the installed file, hash-checked.
3. The expectation is wrong: with rust still locked, install would emit `hexagonal/go.md`
   anyway — if true: `update` keeps it; if false: `update` removes it → **refuted**: `update`
   removes both files.

## Root cause

`remove()` in `bin/cli.mjs` builds `keptInstalled` from the kept records unchanged; the
language filter (`isLanguageDead` against the remaining language profiles) runs only over
`lock.codex.rules`. Claude (`.claude/rules/**/*.md`, `paths:`) and Cursor
(`.cursor/rules/**/*.mdc`, `globs:`) rule files of a kept profile are never re-checked.

## Assumptions

- Autonomy L3 — passed at launch.
- The globs are read from the installed file on disk, refused on a hash mismatch like the
  Codex branch does — the lock holds no globs, and an edited rule has no installed text to judge.

## Blocked on the human

## Log

- phase 1–3: reproduced on `baedc1b` (claude + cursor leftovers, codex clean); `update`
  removes them; the kept record still lists the file.
