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

go-lint:
    cd {{go_dir}} && golangci-lint run ./...
go-check: go-lint
    cd {{go_dir}} && go test -race ./...
    cd {{go_dir}} && go build ./...
    cd {{go_dir}} && govulncheck ./...

# Go has no production-grade mutation tool, so this is the weaker signal: run
# the suite with coverage and read which statements in the code you just touched
# are still at 0%. The numeric ratchet against .coverage-baseline stays in CI
# (kit/go/coverage-ci.yaml) — here you want the map, not the verdict.
go-cover:
    cd {{go_dir}} && go test -race -count=1 -covermode=atomic -coverprofile=coverage.out ./...
    cd {{go_dir}} && go tool cover -func=coverage.out
