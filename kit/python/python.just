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

# Every command goes through `uv run`, so the gate runs against the LOCKED
# environment and not whatever is on this machine (rules/python/environment.md).
#
# `--locked` on EVERY line, and it is not decoration: a bare `uv run` silently
# re-locks when pyproject.toml has drifted from uv.lock, so the gate would repair
# the very thing it is supposed to catch and still go green. `--locked` makes the
# drift an error instead. (`uv lock --check` is the same check, standalone.)
#
# `mypy` takes no path: it reads `files` from [tool.mypy] in pyproject.toml, so
# the scope has one home (and `mypy .` would walk .venv). Same for pytest.
# On poetry/pdm, swap the runner and keep the rest — the invariant is the
# lockfile, not the tool.
python-lint:
    cd {{python_dir}} && uv run --locked ruff format --check .
    cd {{python_dir}} && uv run --locked ruff check .
python-check: python-lint
    cd {{python_dir}} && uv run --locked mypy
    cd {{python_dir}} && uv run --locked pytest
    cd {{python_dir}} && uv run --locked pip-audit
    cd {{python_dir}} && uv run --locked deptry .

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
