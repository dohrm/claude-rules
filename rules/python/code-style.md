---
paths:
  - "**/*.py"
title: "Python Code Style"
---

Format, naming (`N`), mutable defaults (`B006`), unused names (`F`/`ARG`), `assert` as validation (`S101`, tests exempt), and `mypy --strict` signatures: `just python-lint` / `python-check`.

What they do not decide:

- Module *filenames* are `snake_case` (a dash is unimportable). `_name` is private to the package — do not import another module's `_helper`.
- `__all__` re-exports that package's own API only. No aggregation barrels. No `from x import *`.
- No `Any` except an untyped third-party boundary, with a comment on the line. No `cast()` without saying why the checker could not prove it.
- Protocols over ABCs at the boundaries you own. Frozen dataclass / Pydantic at the edges — parse once, then work with types.
- Importing a module does no work beyond constants and definitions.
