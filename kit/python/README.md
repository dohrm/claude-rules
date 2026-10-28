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
| `just python-check` | 2 | pre-push, `just check` | python-lint · `mypy` · `pytest` · `deptry .` · `python-audit` if `uv.lock` changed |
| `just python-audit` | 2 | `python-check` when `uv.lock` changed; a schedule | `pip-audit` |
| `just python-mutate` | 3 | coherent block, never a hook | `mutmut run` + `mutmut results` |

`mypy` takes no path: `[tool.mypy] files` is the scope. `S` / `TRY` /
`G`+`LOG` are why error-handling and logging rules do not need a second
ruff pass. Tests stay free of `S101` (assert) via
`[tool.ruff.lint.per-file-ignores]`.

`python-check` runs `python-audit` only when `uv.lock` changed since its
merge base with `base`, or when that cannot be known (`base` empty or unresolvable,
no merge base in a shallow clone). It prints which before running or skipping it
(`audit: skipped — …`, `audit: … changed`, `audit: … unresolvable`,
`audit: base is empty …`, `audit: no merge base with …`). A branch merely behind a
lock bump on `base` changed nothing, so it skips the audit.
An advisory database moves with the date, not with the diff, so an audit inside
every check turns unrelated PRs red. To ignore an advisory or add a flag, override
the `python_audit` variable, not the recipe: both recipes run it.

## Requirements

| Tool | macOS | Linux | Windows |
|---|---|---|---|
| `uv` | `brew install uv` | official script: `curl -LsSf https://astral.sh/uv/install.sh \| sh` | `winget install astral-sh.uv` (or `powershell -c "irm https://astral.sh/uv/install.ps1 \| iex"`) |

Everything else (`ruff`, `mypy`, `pytest`, `pip-audit`, `deptry`, `mutmut`)
is a `uv`-managed dependency group — see below, not a separate system install.

## Configs — merge once, then they are yours

| File | Destination | Read by | Adapt |
|---|---|---|---|
| `pyproject.snippet.toml` | merge into `<python_dir>/pyproject.toml` | ruff, mypy, pytest, deptry, mutmut | `src`, `files`, `target-version`, mypy overrides |
| `.python-version` | `<python_dir>/.python-version` | uv | match `requires-python` |
| `lefthook.snippet.yml` | merge into root `lefthook.yml` | lefthook | nothing if `just python-*` exists |
| `mutation-ci.yaml` | `.gitea/workflows/` or `.github/workflows/` | CI — **the gate** | runner, `working-directory` |

Dev tools go in a dependency group, never in runtime deps:

```bash
uv add --dev ruff mypy pytest pytest-cov pip-audit deptry
uv add --dev mutmut    # Tier 4 only
```

Commit `pyproject.toml`, `uv.lock`, and `.python-version`.

## What this chain cannot see

`src/` layout, `__all__` / barrels, Protocols vs ABCs, domain exception
hierarchies, adapter translation, `extra=` log fields, `print()`. FastAPI
route annotations and problem+json live in `rules/api/python.md` — this
chain does not see a handler without a return type. Do not invent a
second ruff pass to "translate" them.
