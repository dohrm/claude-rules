---
paths:
  - "**/*.go"
title: "Go Logging (slog)"
---

golangci does not see this. `log/slog`, one JSON handler at startup, a
`*slog.Logger` through DI — no package-level `log.Printf`.

| Level | Usage |
|-------|-------|
| `Error` | Handling boundary — not at every `err` |
| `Warn` | Degraded but recoverable |
| `Info` | Program flow |
| `Debug` | Decision paths |

One log where propagation stops. Log before `_ = doThing()`. Never log a
secret — the key name only.

```go
slog.InfoContext(ctx, "creating user", slog.String("email", email))
```

Typed attrs, `*Context` variants so request-scoped fields propagate.
Cross-cutting fields once via `logger.With` or a context handler.
