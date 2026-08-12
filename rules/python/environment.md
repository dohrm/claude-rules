---
paths:
  - "**/*.py"
title: "Python Environment & Dependencies"
---

**The invariant: one locked, reproducible environment, and every command runs
inside it.** Without that, `just python-check` proves nothing — it passed against
whatever happened to be installed on that machine, which is not a gate.

Rust has `Cargo.lock`, Node has `package-lock.json`. Python's equivalent is a
committed lockfile plus a runner that refuses to drift from it. This repo's
default implementation is **`uv`**.

## Rules

- **`pyproject.toml` declares, `uv.lock` pins. Both are committed.** A
  hand-maintained `requirements.txt` is not a lockfile — it records what someone
  typed, not what resolves.
- **Never install into an ambient interpreter.** No `pip install` in a shell, no
  `sudo pip`, no "it works, I installed it globally". Dependencies enter the
  project through `uv add`, which updates both files together.
- **Every command goes through the project environment** — `uv run pytest`, not
  `pytest`. The justfile recipes already do this; match them when you run
  something by hand.
- **Use `uv run --locked` in anything that gates.** A bare `uv run` *silently
  re-locks* when `pyproject.toml` has drifted from `uv.lock` — so a gate without
  the flag quietly repairs the drift and then reports green, which is the exact
  failure this rule exists to prevent. CI installs with `uv sync --locked` for the
  same reason. `--frozen` is the opposite trade (use the lock as-is, no freshness
  check) and belongs in an image build, not in a gate.
- **Pin the interpreter**: `requires-python` in `pyproject.toml` and a
  `.python-version` file. "Python 3" is not a version.
- **Dev tooling lives in a dev dependency group**, never mixed into the runtime
  dependencies — the production image should not ship `pytest`.

## Layout

- **`src/` layout**: the package lives in `src/<package>/`, tests live in
  `tests/` outside it. This makes the tests import the *installed* package, so a
  missing `__init__.py` or a broken packaging config fails locally instead of at
  deploy time.
- **No `sys.path` manipulation, ever** — no `sys.path.append`, no
  `conftest.py` that patches the path to make imports resolve. An import that
  only works because the path was bent is a packaging bug being hidden.

## If the repo is not on uv

The invariant is the rule; `uv` is one implementation of it. A repo already on
poetry or pdm keeps everything above and swaps the two commands in the justfile
recipes. What is **not** negotiable: a committed lockfile, a gate that installs
from it, no ambient installs.
