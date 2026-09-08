---
paths:
  - "**/*.go"
title: "Go Hexagonal Packaging"
---

## Layer Layout

```
internal/config/   → shared config DTOs (neither core nor infra)
internal/core/     → pure domain (zero infra dependency)
internal/infra/    → adapters & infrastructure implementations
pkg/               → importable libraries (no internal/ dependency)
cmd/               → assembly, CLI entry points
```

## Dependency Rule

```
cmd/ → internal/infra/ → internal/core/
                               ↑
                       NEVER depends on
                       anything above

pkg/ → never imports internal/
```

## What each layer holds

Doctrine: `hexagonal/principle.md`. Its Go rendering:

- **`internal/core/`** — ports and domain types, testable with no infrastructure at
  all: no DB driver, no HTTP framework, no external SDK in its import graph.
- **`internal/infra/`** — every implementation of those ports.
- **`internal/config/`** — DTOs only, neutral, imported by both.

## `pkg/` — Importable Libraries

- Reusable libraries with **no dependency** on internal application wiring (`config/`, `infra/`, sessions, events…)
- If a package depends on internal wiring, it belongs in `internal/`, not `pkg/`

## Package Hygiene

- No orphan packages: a package with 1-2 files and a single consumer should be merged into its consumer
- Use sub-packages for large families, but avoid fragmentation — no sub-package for fewer than 3 files
- User-facing clients (TUI, WS client) live in `clients/` — internal interface implementations live in `internal/infra/`
