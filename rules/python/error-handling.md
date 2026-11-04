---
paths:
  - "**/*.py"
title: "Python Error Handling"
---

Bare `except`, `except Exception: pass`, a blind `except Exception` that neither re-raises nor logs the traceback, and `raise` without `from` inside an `except`: `just python-lint` (ruff `S110` / `BLE` / `TRY` / `B904`).

What ruff does not decide:

- `except Exception:` only at the request/worker boundary, and there `logger.exception(...)`. Catch only the statement that can fail. Expected absence is `None` (or empty), not an exception.
- One base exception per package; infrastructure errors (`sqlalchemy`, `httpx`, …) are translated at the adapter, cause chained. Otherwise the hexagon leaks.
- Structured attributes, not a sentence: `raise QuotaExceeded(limit=100, used=137)` — see `backend/errors.md`.
- Resources: `with` / `contextlib`. A bare `create_task` must be awaited or given a done-callback that logs.
- Async: blocking calls are `ASYNC` findings; CPU-heavy or sync-only library work goes through `asyncio.to_thread`. Every outbound call has a timeout.
- No module-level mutable state shared across requests — a cache is explicit, bounded and owned.
