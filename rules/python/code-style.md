---
paths:
  - "**/*.py"
title: "Python Code Style"
---

Formatting is `ruff format`'s job and is never discussed in review. What follows
is what a formatter cannot decide.

## Naming & modules

- **Modules and packages are `snake_case`** — `billing_list.py`, never a dash
  (unimportable) and never `CamelCase.py`.
- `PascalCase` for classes and type aliases, `snake_case` for functions and
  variables, `UPPER_SNAKE` for module-level constants.
- A leading underscore means *private to this module/package* and is respected —
  importing another module's `_helper` is a design smell, not a shortcut.

## Public surface

- A package's `__init__.py` declares its public surface with `__all__` and
  re-exports **only that package's own API**.
- **No aggregation barrels** — an `__init__.py` that re-exports a whole subtree
  invites circular imports and makes every import pull half the codebase. Same
  rule as the TypeScript barrel policy.
- Import modules or explicit names; never `from x import *`.

## Typing

Types are the compiler this language does not have — write them as if they were.

- **Annotate every function signature**, parameters and return alike, including
  `-> None`. `mypy --strict` enforces this; do not carve out exceptions.
- **No `Any`.** Use a precise type, a generic, or `object` + narrowing. `Any` is
  allowed only at a genuinely untyped boundary (a third-party package with no
  stubs) and only with a justification comment on the same line.
- **Model absence explicitly** with `T | None` and narrow it. Do not reach for
  `cast()` to silence the checker — a `cast` asserts something the checker could
  not prove, so it needs a comment saying why it holds.
- **Protocols over ABCs** for the boundaries you own: structural typing keeps the
  dependency pointing inward, and needs no base class in the implementer.
- Prefer immutable, explicit data at the edges — a frozen `dataclass` or a
  Pydantic model — over `dict[str, Any]` passed between layers. **Parse once at
  the boundary**, then work with types.

## Traps the linter catches, and you should not write anyway

- **No mutable default arguments** (`def f(xs: list[int] = [])`) — the default is
  shared across calls. Use `None` and build inside.
- **No `assert` for runtime validation**: `python -O` strips it. Assertions are
  for invariants that tests prove, never for checking input.
- No logic in a module's import-time body beyond constants and definitions —
  importing a module must not do work.
