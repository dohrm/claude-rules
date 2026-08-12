---
paths:
  - "**/*.py"
title: "Python Error Handling"
---

Exceptions are the idiom — but an exception that crosses a boundary untranslated,
or is caught and dropped, is how a Python service loses the cause of its own
outage.

## Rules

- **Never catch what you will not handle.** No bare `except:` (it swallows
  `KeyboardInterrupt` and `SystemExit`) and no `except Exception:` unless the
  handler re-raises, or is the outermost boundary of a request/worker loop — and
  there it must log with `logger.exception(...)`.
- **Never swallow silently.** `except SomeError: pass` needs a comment stating
  why nothing is the correct response. Usually it is not.
- **Always chain the cause**: `raise DomainError("creating user") from err`. This
  is Go's `%w`: it keeps the original traceback attached. Bare `raise X(...)`
  inside an `except` block hides what actually happened. Use `from None` only to
  deliberately cut a noisy cause, with a comment.
- **Catch narrowly, and only around the statement that can fail** — a `try` block
  wrapping thirty lines catches errors from code you never meant to guard.
- **Expected absence is a return value, not an exception.** A lookup that
  routinely finds nothing returns `None` (or an empty collection); reserve
  raising for the genuinely exceptional.

## One hierarchy, translated at the boundary

- Each package defines **one base exception** (`class BillingError(Exception)`)
  and derives its domain errors from it. Callers can then catch the package's
  failures without catching everything.
- **Infrastructure exceptions are translated at the adapter.** A
  `sqlalchemy.OperationalError` or an `httpx.HTTPStatusError` must never reach
  the domain or a route handler — the adapter that owns the technology catches it
  and raises the domain error, chaining the cause. Otherwise the domain depends
  on the driver, and the hexagon leaks.
- Exception classes carry **structured attributes**, not a formatted sentence:
  `raise QuotaExceeded(limit=100, used=137)`. The message is for humans, the
  attributes are what the HTTP layer maps to the `problem+json` contract (see
  `backend/errors.md`).

## Cleanup

- Release resources with `with` / `contextlib`, never a `finally` block that
  hand-rolls what a context manager already does.
- In `async` code, never let an exception escape a bare `create_task` — the task
  dies and the error surfaces as a "Task exception was never retrieved" line in
  the logs, far from the cause. Await it, or attach a done-callback that logs.
