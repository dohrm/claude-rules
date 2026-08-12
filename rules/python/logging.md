---
paths:
  - "**/*.py"
title: "Python Logging"
---

Structured logging via the standard library **`logging`**, configured **once** at
startup with a JSON formatter (`structlog` is a fine wrapper — the rules below
hold either way). **No `print()` in application code**, ever.

| Level | Usage |
|-------|-------|
| `error` | At the handling boundary only — not at every `raise` |
| `warning` | Degraded but recoverable |
| `info` | Program flow |
| `debug` | Decision paths, intermediate values |

- **One logger per module**: `logger = logging.getLogger(__name__)` at module
  level. That is the Python idiom — the hierarchy comes from the module path, so
  levels stay configurable per package. Never the root logger, never `logging.info(...)`
  called directly.
- **Log at the handling boundary** — one log where propagation stops, not at
  every `except … raise`. A cause chained with `from` already carries the story.
- **Inside an `except`, use `logger.exception(...)`** (or `exc_info=True`) so the
  traceback is captured. A message without the traceback throws away the only
  part that locates the bug.
- **Never log secret values** — log the key name only.
- Libraries add a `NullHandler` and configure nothing. Only the application entry
  point configures handlers.

## Structured fields

```python
logger.info("creating user", extra={"user_id": user_id, "tenant": tenant})
```

- Fields go in `extra=`, **never interpolated into the message**. `f"creating user {user_id}"`
  makes every line a distinct string — unsearchable and ungroupable. The message
  is a constant; the variables are fields.
- Attach cross-cutting fields (service, version, request id) once, in the
  formatter or a `contextvars`-backed filter — not at every call site.
- Correlate with the API error contract: a `5xx` logs the cause plus the
  correlation id returned to the client (see `backend/errors.md`).

## Checklist

- [ ] Logging configured once at startup, JSON formatter, no `print()`
- [ ] `getLogger(__name__)` per module, never the root logger
- [ ] Logged at the handling boundary, once per error, with the traceback
- [ ] Variables in `extra=`, message is a constant
- [ ] No secret value logged — key name only
