---
paths:
  - "**/*.go"
title: "Go Quality Gates"
---

```bash
just go-check     # go-lint → test -race → build → govulncheck
```

`go-lint` is pre-commit; `go-check` is pre-push and `just check`. Tier 3
is `just go-cover` — a coverage map, never mutation, never a hook.
Wiring: `.dev/kit/go/README.md`. Needs **golangci-lint v2**.

| Recipe | Command | Config |
|---|---|---|
| `go-lint` | `golangci-lint run ./...` | `.golangci.yml` ← `golangci.base.yml` (gofmt, errcheck, staticcheck, govet, unused, gosec) |
| `go-check` | `go test -race ./...` | — |
| `go-check` | `go build ./...` | — |
| `go-check` | `govulncheck ./...` | — |
| `go-cover` | `go test -coverprofile` + `go tool cover -func` | `.coverage-baseline` (CI ratchet only) |

No `//nolint` or `staticcheck:ignore` without a reason on the same line.
Never loosen `.golangci.yml` to pass.

What golangci does not decide: prefer `internal/` (do not export at the
module root unless intentional); wrap with `fmt.Errorf("context: %w", err)`.
slog and proto / `pb.*`: sibling rules.
