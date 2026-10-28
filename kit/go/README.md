# kit/go — the Go validation chain

This is a **jalon**: a language module whose toolchain already sees
format, lint, types (the compiler), tests with the race detector,
vulnerabilities, and (opt-in) a coverage ratchet. Go has no
production-grade mutation tool — `go-cover` is the weaker signal, and
the file header on `coverage-ci.yaml` says why. The recipes own the
commands. The installer copies this directory to `.dev/kit/go/` and
**never merges** the config — you copy it once.

`claude-rules init` writes `import '.dev/kit/go/go.just'` and derives
`go_dir` from the lock. Lefthook is a thin trigger: merge
`lefthook.snippet.yml` so pre-commit runs `just go-lint` and pre-push
runs `just go-check`.

## The chain

| Recipe | Tier | When | What it runs |
|---|---|---|---|
| `just go-lint` | 1 | pre-commit | `golangci-lint run ./...` (gofmt + errcheck + staticcheck + govet + unused + gosec + lifecycle/context: bodyclose, sqlclosecheck, rowserrcheck, noctx, contextcheck, containedctx, errorlint, nilerr, exhaustive) |
| `just go-check` | 2 | pre-push, `just check` | go-lint · `go test -race ./...` · `go build ./...` · `go-audit` if `go.sum` changed |
| `just go-audit` | 2 | `go-check` when `go.sum` changed; a schedule | `govulncheck ./...` |
| `just go-cover` | 3 | coherent block, never a hook | `go test -coverprofile` + `go tool cover -func` — the map, not the verdict |

`go build` is a separate line from `go test`: a package with no test
files still has to compile. `errcheck` is why unhandled errors do not
need a second lint pass.

`go-check` runs `go-audit` only when `go.sum` changed since its
merge base with `base`, or when that cannot be known (`base` empty or unresolvable,
no merge base in a shallow clone). It prints which before running or skipping it
(`audit: skipped — …`, `audit: … changed`, `audit: … unresolvable`,
`audit: base is empty …`, `audit: no merge base with …`). A branch merely behind a
lock bump on `base` changed nothing, so it skips the audit.
An advisory database moves with the date, not with the diff, so an audit inside
every check turns unrelated PRs red. To ignore an advisory or add a flag, override
the `go_audit` variable, not the recipe: both recipes run it.
A standard-library finding is fixed by the Go toolchain version (runner image,
setup action), not by `go.mod`.

Needs on the machine and the runner: `go`, `golangci-lint` **v2**,
`govulncheck`.

## Requirements

| Tool | macOS | Linux | Windows |
|---|---|---|---|
| `go` | `brew install go` | your distro's package, or the [official tarball](https://go.dev/dl/) | `winget install GoLang.Go` |

Once `go` is on the `PATH`, the rest is one command everywhere:

```bash
go install github.com/golangci/golangci-lint/v2/cmd/golangci-lint@latest
go install golang.org/x/vuln/cmd/govulncheck@latest
```

## Configs — copy once, then they are yours

| File | Destination | Read by | Adapt |
|---|---|---|---|
| `golangci.base.yml` | `<go_dir>/.golangci.yml` | `golangci-lint` (go-lint) | enable list, exclusions for generated |
| `lefthook.snippet.yml` | merge into root `lefthook.yml` | lefthook | nothing if `just go-*` exists |
| `coverage-ci.yaml` | `.gitea/workflows/` or `.github/workflows/` | CI, the witness | runner, `working-directory` |
| `.coverage-baseline` | `<go_dir>/.coverage-baseline` | the coverage job | raise only |

## What this chain cannot see

`internal/` vs exported root, `%w` wrapping, slog fields / `print`, proto
layout and hexagonal mapping of `pb.*`. Those stay in `rules/go/` as a
mention for the reviewer. Do not invent a second golangci pass to
"translate" them.
