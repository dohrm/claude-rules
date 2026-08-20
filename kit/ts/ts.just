# TypeScript gates — a just LIBRARY, imported by the repo's root justfile:
#
#     import '.dev/kit/ts/ts.just'
#
# `claude-rules init` writes that line for you, and `claude-rules update` refreshes
# THIS file — so a fix here reaches a repo that installed months ago. Do not edit it:
# override instead. A recipe or variable in the root justfile wins over an imported
# one, which is what the `set allow-duplicate-*` lines at the top of that file buy.
#
# Recipes run with the working directory of the ROOT justfile, never of this file, so
# every path below is repo-relative.

ts_dir := "."      # overridden from the root justfile (managed block)

ts-lint:
    cd {{ts_dir}} && npm run lint
ts-check: ts-lint
    cd {{ts_dir}} && npm run test
    cd {{ts_dir}} && npm run build

# StrykerJS has no `--since`: it has `--incremental`, which reuses the previous
# report and re-tests only what changed — same outcome, one flag, no file list
# to compute. The first run is a full one; every run after it is minutes.
# Needs: npm i -D @stryker-mutator/core + a runner, then npx stryker init.
ts-mutate:
    cd {{ts_dir}} && npx stryker run --incremental
