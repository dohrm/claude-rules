---
paths:
  - "**/*.go"
title: "Go Logging (slog)"
---

Structured logging via the standard library **`log/slog`**. One JSON handler configured at startup, a `*slog.Logger` passed through DI — no package-level `log.Printf`.

| Level | Usage |
|-------|-------|
| `Error` | At handling boundary only — not at every returned `err` |
| `Warn`  | Degraded but recoverable |
| `Info`  | Program flow |
| `Debug` | Decision paths, intermediate values |

Log at the **handling boundary** — one log where error propagation stops, not at every `if err != nil { return err }`.

Never swallow an error silently (`_ = doThing()`) — handle or log before discarding.

**Never log secret values** — log the key name only.

## Structured fields

```go
slog.InfoContext(ctx, "creating user", slog.String("email", email))
```

- Prefer typed attrs (`slog.String`, `slog.Int`, `slog.Any`) over `fmt.Sprintf` into the message.
- Always use the `Context` variants (`InfoContext`, `ErrorContext`) so request-scoped fields (request id, user id) propagate.

## Setup

```go
logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: level}))
slog.SetDefault(logger)
```

- JSON handler in all environments (a text handler is fine for local dev only).
- Attach cross-cutting fields (service, version, request id) once, via `logger.With(...)` or a context handler — don't repeat them at every call site.
- Correlate with the API error contract: a `5xx` logs the cause + the correlation id returned to the client (see `backend/errors.md`).

## Checklist

- [ ] One `slog` JSON handler configured at startup, logger injected (no global `log`)
- [ ] Logged at the handling boundary, once per error
- [ ] `Context` variants used so request-scoped fields propagate
- [ ] No secret value logged — key name only
