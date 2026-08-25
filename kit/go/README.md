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
| `just go-lint` | 1 | pre-commit | `golangci-lint run ./...` (gofmt + errcheck + staticcheck + govet + unused + gosec) |
| `just go-check` | 2 | pre-push, `just check` | go-lint · `go test -race ./...` · `go build ./...` · `govulncheck ./...` |
| `just go-cover` | 3 | coherent block, never a hook | `go test -coverprofile` + `go tool cover -func` — the map, not the verdict |

`go build` is a separate line from `go test`: a package with no test
files still has to compile. `errcheck` is why unhandled errors do not
need a second lint pass.

Needs on the machine and the runner: `go`, `golangci-lint` **v2**,
`govulncheck`.

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
