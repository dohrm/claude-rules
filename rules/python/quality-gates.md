---
paths:
  - "**/*.py"
title: "Python Quality Gates"
---

```bash
just python-check     # python-lint → mypy → pytest → pip-audit + deptry
```

Every line is `uv run --locked`. `python-lint` is pre-commit; `python-check` is pre-push and `just check`. Tier 3 is `just python-mutate` — never a hook. Wiring: `.dev/kit/python/README.md`.

| Recipe | Command | Config (merge `pyproject.snippet.toml`) |
|---|---|---|
| `python-lint` | `ruff format --check .` | `[tool.ruff]` |
| `python-lint` | `ruff check .` | `[tool.ruff.lint]` (`S` `TRY` `G`/`LOG` …) |
| `python-check` | `mypy` | `[tool.mypy]` (`strict = true`) |
| `python-check` | `pytest` | `[tool.pytest.ini_options]` |
| `python-check` | `pip-audit` | — |
| `python-check` | `deptry .` | `[tool.deptry]` |
| `python-mutate` | `mutmut run` | `[tool.mutmut]` |

No bare `# noqa` or `# type: ignore` — name the code and why. Never loosen ruff or mypy to pass. A legacy mypy override list may only shrink (`testing/ratchet.md`).

Sibling rules cover what ruff/mypy do not: `src/` layout, `__all__`, Protocols, domain exceptions, `extra=` / `print()`.
