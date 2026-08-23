# kit/python — the Python validation chain

This is a **jalon**: a language module whose toolchain already sees
format, lint, types, tests, vulnerabilities, unused deps, and (opt-in)
mutation. The recipes own the commands. The snippet below is the config
those commands read. The installer copies this directory to
`.dev/kit/python/` and **never merges** the snippet into
`pyproject.toml` — you merge it once.

`claude-rules init` writes `import '.dev/kit/python/python.just'` and
derives `python_dir` from the lock. Lefthook is a thin trigger: merge
`lefthook.snippet.yml` so pre-commit runs `just python-lint` and
pre-push runs `just python-check`.

Every recipe line is `uv run --locked …`. That is the environment
invariant (`rules/python/environment.md`): the gate is only worth its
exit code if it ran inside the committed lock. On poetry/pdm, swap the
runner and keep the rest.

## The chain

| Recipe | Tier | When | What it runs |
|---|---|---|---|
| `just python-lint` | 1 | pre-commit | `ruff format --check .` · `ruff check .` |
| `just python-check` | 2 | pre-push, `just check` | python-lint · `mypy` · `pytest` · `pip-audit` · `deptry .` |
| `just python-mutate` | 3 | coherent block, never a hook | `mutmut run` + `mutmut results` |

`mypy` takes no path: `[tool.mypy] files` is the scope. `S` / `TRY` /
`G`+`LOG` are why error-handling and logging rules do not need a second
ruff pass. Tests stay free of `S101` (assert) via
`[tool.ruff.lint.per-file-ignores]`.

## Configs — merge once, then they are yours

| File | Destination | Read by | Adapt |
|---|---|---|---|
| `pyproject.snippet.toml` | merge into `<python_dir>/pyproject.toml` | ruff, mypy, pytest, deptry, mutmut | `src`, `files`, `target-version`, mypy overrides |
| `.python-version` | `<python_dir>/.python-version` | uv | match `requires-python` |
| `lefthook.snippet.yml` | merge into root `lefthook.yml` | lefthook | nothing if `just python-*` exists |
| `mutation-ci.yaml` | `.gitea/workflows/` or `.github/workflows/` | CI, the witness | runner, `working-directory` |

Dev tools go in a dependency group, never in runtime deps:

```bash
uv add --dev ruff mypy pytest pytest-cov pip-audit deptry
uv add --dev mutmut    # Tier 3 only
```

Commit `pyproject.toml`, `uv.lock`, and `.python-version`.

## What this chain cannot see

`src/` layout, `__all__` / barrels, Protocols vs ABCs, domain exception
hierarchies, adapter translation, `extra=` log fields, `print()`. Those
stay in `rules/python/` as short prose for the reviewer. Do not invent
a second ruff pass to "translate" them.
