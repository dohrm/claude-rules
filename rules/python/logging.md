---
paths:
  - "**/*.py"
title: "Python Logging"
---

An f-string or `%` in the log *message*: `just python-lint` (ruff `G` / `LOG`). `print()` is not gated — never in application code.

| Level | Usage |
|-------|-------|
| `error` | Handling boundary — not at every `raise` |
| `warning` | Degraded but recoverable |
| `info` | Program flow |
| `debug` | Decision paths |

`logger = logging.getLogger(__name__)` per module — never the root logger. One log where propagation stops; inside `except`, `logger.exception(...)`. Never log a secret — the key name only.

```python
logger.info("creating user", extra={"user_id": user_id})
```

Fields in `extra=`. Cross-cutting fields (request id) once, in the formatter or a `contextvars` filter. Libraries add a `NullHandler` and configure nothing; only the entry point does.
