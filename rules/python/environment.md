---
paths:
  - "**/*.py"
title: "Python Environment & Dependencies"
---

`just python-check` is `uv run --locked`. That is the gate — a bare `uv run` would re-lock and go green. CI is `uv sync --locked`. `--frozen` is for an image build, not a gate.

Still true outside the recipe:

- Commit `pyproject.toml`, `uv.lock`, and `.python-version`. `requirements.txt` is not a lockfile.
- Dependencies enter through `uv add`. Never ambient `pip install`.
- Dev tools in a dependency group, never in the runtime set.
- `src/<package>/` + `tests/` outside it. No `sys.path` manipulation — an import that needs a bent path is a packaging bug.
- Poetry or pdm: keep the invariant, swap the two runner lines in the justfile.
