# ADR-0010: The installer writes only over what it owns, and refuses a tree it cannot explain

- **Status**: Accepted
- **Date**: 2026-10-13

## Context

ADR-0008 adds layers, `exclude` and removals over an existing install. Built as
reconciliation, its first two phases took 19 critical review findings: files deleted that
the repo owned, stale copies, a file turning into a directory. Each finding is one more
combination of previous state, layer and target. Codex already avoids this class:
`bin/codex.mjs` keeps a hash per owned file and refuses conflicting local content
(ADR-0003). Claude, Cursor and the kit have no such record, and their copies are
overwritten unchecked (ADR-0008 § Context).

## Decision

We will give every target the Codex ownership model, and refuse instead of reconcile.

- **Inventory**: the lock records every file the installer wrote, with its hash, for every
  target.
- **Check before writing**: every path to write or delete must be absent, or owned and
  unchanged. Anything else is a corruption: the installer lists the paths and changes
  nothing.
- **Way out**: `--force` overwrites the listed paths and records them again; otherwise the
  user fixes the tree, typically by moving the edit into `.dev/overrides/`.
- **Apply**: delete what is owned and no longer produced, then write.
- **Adoption, once**: the first `update` from a lock without file hashes warns that every
  installed destination will be overwritten, then records them. Without a terminal it
  requires `--force`.

## Consequences

A hand edit inside an installed rule or skill now stops `update` instead of vanishing:
safer, but it is a breaking change for repos that relied on silent overwrite. Ambiguous
transitions (a file turning into a directory, nested destinations, a foreign file inside a
skill) are errors, not features. The first update after this change overwrites unrecorded
local edits once. One ownership code path replaces two.

## Alternatives considered

- **Reconcile every transition**: 19 critical findings in two phases, and the state space
  keeps growing with each layer and target.
- **Overwrite unchecked (today for Claude/Cursor)**: loses local edits silently, and
  ADR-0008's overlays cannot tell an edit from a stale copy.
- **Per-path `--force`**: finer, but adds syntax for a case that the printed list already
  covers.
