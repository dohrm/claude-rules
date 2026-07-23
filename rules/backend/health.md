---
paths:
  - "**/*.rs"
  - "**/*.go"
  - "**/*.ts"
title: "Backend — Health & Lifecycle"
---

A service states its health and shuts down cleanly. Two probes, one graceful-shutdown path.

## Probes

- **Liveness** (`GET /@/live`) — is the process up? Cheap, no dependency checks. Failing = restart me.
- **Readiness** (`GET /@/ready`) — can I serve traffic right now? Checks critical dependencies (DB, broker). Failing = stop routing to me, don't restart.
- Keep them unauthenticated but cheap, and **exclude them from request logging** (they are noise).
- Readiness returns `200` with a per-dependency breakdown, or `503` if any critical one is down — never fake `200` when a dependency is unreachable.

## Graceful shutdown

On `SIGTERM`/`SIGINT`:

1. Flip readiness to **not ready** (stop taking new work).
2. Stop accepting new connections; let in-flight requests finish within a bounded timeout.
3. Close resources in reverse init order (drain broker consumers, close DB pool, flush logs/traces).
4. Exit `0`. If the drain timeout elapses, exit anyway — don't hang forever.

## Rules

- Shutdown is **bounded** by a timeout — a hung dependency must not block exit.
- No new work is accepted once shutdown starts.
- Readiness reflects real dependency state; liveness never depends on downstreams (or a slow DB triggers a restart loop).

## Per-language note

- **Rust** — `axum::serve(...).with_graceful_shutdown(signal_future)`; `tokio::signal`.
- **Go** — `signal.NotifyContext` + `http.Server.Shutdown(ctx)` with a timeout context.
- **Node** — listen for `SIGTERM`; `app.close()` (Fastify runs `onClose` hooks) under a timeout.

## Checklist

- [ ] Separate `live` and `ready` probes, health checks excluded from logs
- [ ] Readiness checks critical deps and returns 503 when they are down
- [ ] SIGTERM flips readiness off, then drains in-flight requests
- [ ] Shutdown is bounded by a timeout and closes resources in reverse order
- [ ] Liveness does not depend on downstream services
