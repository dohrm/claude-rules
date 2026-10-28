# Python gates — a just LIBRARY, imported by the repo's root justfile:
#
#     import '.dev/kit/python/python.just'
#
# `claude-rules init` writes that line for you, and `claude-rules update` refreshes
# THIS file — so a fix here reaches a repo that installed months ago. Do not edit it:
# override instead. A recipe or variable in the root justfile wins over an imported
# one, which is what the `set allow-duplicate-*` lines at the top of that file buy.
#
# Recipes run with the working directory of the ROOT justfile, never of this file, so
# every path below is repo-relative.

python_dir := "."  # overridden from the root justfile (managed block)

# The trunk `*-check` compares the lock against. kit/common/gate.just defines the same
# default; allow-duplicate-variables on the root justfile lets either win. Defined here
# so this file parses without common.
base := "origin/main"

# Every command goes through `uv run --locked`, so the gate runs against the
# LOCKED environment and not whatever is on this machine
# (rules/python/environment.md). A bare `uv run` silently re-locks when
# pyproject.toml has drifted from uv.lock — the gate would repair the drift and
# still go green. (`uv lock --check` is the same check, standalone.)
#
# Configs the commands read — MERGE pyproject.snippet.toml into
# {{python_dir}}/pyproject.toml, the installer never merges it. See README.md.
#
# `mypy` takes no path: it reads `files` from [tool.mypy], so the scope has one
# home (and `mypy .` would walk .venv). Same for pytest. On poetry/pdm, swap the
# runner and keep the rest — the invariant is the lockfile, not the tool.
python-lint:
    cd {{python_dir}} && uv run --locked ruff format --check .
    cd {{python_dir}} && uv run --locked ruff check .
python-check: python-lint && (_audit-gate python_dir "uv.lock" python_audit)
    cd {{python_dir}} && uv run --locked mypy
    cd {{python_dir}} && uv run --locked pytest
    cd {{python_dir}} && uv run --locked deptry .

# Time-dependent: its verdict moves with the advisory database, not with the diff.
# Override `python_audit` (e.g. `--ignore-vuln <id>`), never the recipe: `python-check`
# runs the same command when uv.lock changed.
python_audit := "uv run --locked pip-audit"
python-audit:
    cd {{python_dir}} && {{python_audit}}

# The audit leaves the gate unless the diff touches the lock. An advisory database
# moves on its own schedule, not with the diff: an audit inside `*-check` turns a
# docs-only PR red the day a CVE is published (rules/cicd/pipeline.md). So `*-check`
# runs the audit only when the lock changed against `base` (two-dot against its tip,
# the working tree and an untracked lock included, so no merge base is needed), or
# when `base` does not resolve: not knowing is not a reason to skip. It prints
# `audit: …` (skipped, changed, unresolvable, empty base) before running or skipping it.
# `*-audit` runs the tool unconditionally — the scheduled job (kit/cicd) calls it
# daily on the default branch.
# This recipe is identical in go.just, python.just and rust.just; the
# allow-duplicate-recipes header keeps one.
_audit-gate dir lock cmd:
    @if [ -z {{quote(base)}} ]; then \
        echo 'audit: base is empty (in CI: kit/common missing, or ci-base failed to fetch)'; \
    elif ! git rev-parse --verify --quiet {{quote(base)}} >/dev/null 2>&1; then \
        echo {{quote("audit: " + base + " unresolvable")}}; \
    elif git diff --quiet {{quote(base)}} -- {{quote(dir / lock)}} \
        && [ -z "$(git ls-files --others --exclude-standard -- {{quote(dir / lock)}})" ]; then \
        echo {{quote("audit: skipped — " + dir / lock + " unchanged against " + base)}}; exit 0; \
    else \
        echo {{quote("audit: " + dir / lock + " changed")}}; \
    fi; \
    cd {{quote(dir)}} && {{cmd}}

# mutmut has no diff mode (no `--in-diff`, no `--since`) — it is path-scoped. It
# does cache its results, so a re-run only re-tests what actually changed, which
# is the same outcome as Stryker's `--incremental`: first run long, every one
# after it minutes. Scope comes from [tool.mutmut] source_paths in pyproject.toml;
# narrow it with `--paths-to-mutate src/billing` when the package gets big. CI
# scopes to the PR's changed files instead (kit/python/mutation-ci.yaml).
# Needs: uv add --dev mutmut. Gitignore `mutants/`.
python-mutate:
    cd {{python_dir}} && uv run mutmut run
    cd {{python_dir}} && uv run mutmut results
