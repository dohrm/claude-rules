# Go gates — a just LIBRARY, imported by the repo's root justfile:
#
#     import '.dev/kit/go/go.just'
#
# `claude-rules init` writes that line for you, and `claude-rules update` refreshes
# THIS file — so a fix here reaches a repo that installed months ago. Do not edit it:
# override instead. A recipe or variable in the root justfile wins over an imported
# one, which is what the `set allow-duplicate-*` lines at the top of that file buy.
#
# Recipes run with the working directory of the ROOT justfile, never of this file, so
# every path below is repo-relative.

go_dir := "."      # overridden from the root justfile (managed block)

# The trunk `*-check` compares the lock against. kit/common/gate.just defines the same
# default; allow-duplicate-variables on the root justfile lets either win. Defined here
# so this file parses without common.
base := "origin/main"

# Config golangci-lint reads — COPY golangci.base.yml → {{go_dir}}/.golangci.yml,
# the installer never merges it. Needs golangci-lint v2 (v1 will not parse the
# shipped file). See README.md.
#
# errcheck is the unhandled-error gate. gofmt lives under formatters in the
# v2 config and still runs as part of `golangci-lint run`.
go-lint:
    cd {{go_dir}} && golangci-lint run ./...
go-check: go-lint && (_audit-gate go_dir "go.sum" go_audit)
    cd {{go_dir}} && go test -race ./...
    cd {{go_dir}} && go build ./...

# Time-dependent: its verdict moves with the advisory database, not with the diff.
# Override `go_audit`, never the recipe: `go-check` runs the same command when go.sum
# changed. A standard-library finding is fixed by the Go toolchain version (runner
# image, setup action), not by go.mod.
go_audit := "govulncheck ./..."
go-audit:
    cd {{go_dir}} && {{go_audit}}

# The audit leaves the gate unless the diff touches the lock. An advisory database
# moves on its own schedule, not with the diff: an audit inside `*-check` turns a
# docs-only PR red the day a CVE is published (rules/cicd/pipeline.md). So `*-check`
# runs the audit only when the lock changed against `base` (two-dot against its tip,
# the working tree and an untracked lock included, so no merge base is needed), or
# when `base` does not resolve: not knowing is not a reason to skip. It prints
# `audit: …` (skipped, changed, unresolvable) before running or skipping the audit.
# `*-audit` runs the tool unconditionally — the scheduled job (kit/cicd) calls it
# daily on the default branch.
# This recipe is identical in go.just, python.just and rust.just; the
# allow-duplicate-recipes header keeps one.
_audit-gate dir lock cmd:
    @if ! git rev-parse --verify --quiet {{quote(base)}} >/dev/null 2>&1; then \
        echo {{quote("audit: " + base + " unresolvable")}}; \
    elif git diff --quiet {{quote(base)}} -- {{quote(dir / lock)}} \
        && [ -z "$(git ls-files --others --exclude-standard -- {{quote(dir / lock)}})" ]; then \
        echo {{quote("audit: skipped — " + dir / lock + " unchanged against " + base)}}; exit 0; \
    else \
        echo {{quote("audit: " + dir / lock + " changed")}}; \
    fi; \
    cd {{quote(dir)}} && {{cmd}}

# Go has no production-grade mutation tool, so this is the weaker signal: run
# the suite with coverage and read which statements in the code you just touched
# are still at 0%. The numeric ratchet against .coverage-baseline stays in CI
# (kit/go/coverage-ci.yaml) — here you want the map, not the verdict.
go-cover:
    cd {{go_dir}} && go test -race -count=1 -covermode=atomic -coverprofile=coverage.out ./...
    cd {{go_dir}} && go tool cover -func=coverage.out
