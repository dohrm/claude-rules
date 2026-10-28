---
paths:
  - "**/*.py"
title: "Python Quality Gates"
---

```bash
just python-check     # python-lint → mypy → pytest → deptry → python-audit if uv.lock changed
```

Every line is `uv run --locked`. `python-lint` is pre-commit; `python-check` is pre-push and `just check`. Tier 4 is `just python-mutate` — never a hook. Wiring: `.dev/kit/python/README.md`. `python-check` runs the audit only when `uv.lock` changed since its merge base with `base` (or that cannot be known), and prints which: an advisory database moves with the date, not the diff (`rules/cicd/pipeline.md`). `just python-audit` runs it always.

| Recipe | Command | Config (merge `pyproject.snippet.toml`) |
|---|---|---|
| `python-lint` | `ruff format --check .` | `[tool.ruff]` |
| `python-lint` | `ruff check .` | `[tool.ruff.lint]` (`S` `TRY` `G`/`LOG` `ASYNC` `BLE` `DTZ` `T20` `PERF` …) |
| `python-check` | `mypy` | `[tool.mypy]` (`strict = true`) |
| `python-check` | `pytest` | `[tool.pytest.ini_options]` |
| `python-check` | `deptry .` | `[tool.deptry]` |
| `python-audit` | `pip-audit` | — |
| `python-mutate` | `mutmut run` | `[tool.mutmut]` |

No bare `# noqa` or `# type: ignore` — name the code and why. Never loosen ruff or mypy to pass. A legacy mypy override list may only shrink (`testing/ratchet.md`).

Sibling rules cover what ruff/mypy do not: `src/` layout, `__all__`, Protocols, domain exceptions, `extra=`. FastAPI typed routes and problem+json: `rules/api/python.md`.
