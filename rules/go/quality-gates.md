---
paths:
  - "**/*.go"
title: "Go Quality Gates"
---

```bash
just go-check     # go-lint → test -race → build → go-audit if go.sum changed
```

`go-lint` is pre-commit; `go-check` is pre-push and `just check`. Tier 4
is `just go-cover` — a coverage map, never mutation, never a hook.
Wiring: `.dev/kit/go/README.md`. Needs **golangci-lint v2**.
`go-check` runs the audit only when `go.sum` changed against `base` (or
`base` does not resolve), and prints which: an advisory database moves
with the date, not the diff (`rules/cicd/pipeline.md`). `just go-audit`
runs it always. A standard-library finding is fixed by the Go toolchain
version, not by `go.mod`.

| Recipe | Command | Config |
|---|---|---|
| `go-lint` | `golangci-lint run ./...` | `.golangci.yml` ← `golangci.base.yml` (gofmt, errcheck, staticcheck, govet, unused, gosec, bodyclose, sqlclosecheck, rowserrcheck, noctx, contextcheck, containedctx, errorlint, nilerr, exhaustive) |
| `go-check` | `go test -race ./...` | — |
| `go-check` | `go build ./...` | — |
| `go-audit` | `govulncheck ./...` | — |
| `go-cover` | `go test -coverprofile` + `go tool cover -func` | `.coverage-baseline` (CI ratchet only) |

No `//nolint` or `staticcheck:ignore` without a reason on the same line.
Never loosen `.golangci.yml` to pass.

What golangci does not decide: prefer `internal/` (do not export at the
module root unless intentional). Goroutine ownership, channels, slog and
proto / `pb.*`: sibling rules.
