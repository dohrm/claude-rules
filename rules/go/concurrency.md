---
paths:
  - "**/*.go"
title: "Go Concurrency & Resources"
---

Closed bodies and rows, `rows.Err()`, a context on outbound calls and passed on,
`%w` and `errors.Is`, exhaustive enum switches: `just go-lint`. `-race` runs in
`go-check`, but only on the paths a test drives.

What they do not decide:

- Every goroutine has an owner that can stop it and see its error — `errgroup`
  for fan-out. No goroutine waits forever on a channel nothing will close.
- Only the sender closes a channel, and exactly one sender does.
- No `defer` inside an unbounded loop — extract the iteration into a function.
- A writer's `Close` / `Commit` error is returned, not dropped by a bare `defer`.
- Never return a typed nil pointer as an `error` — return a literal `nil`.
- Retries are bounded, with backoff, and stop when the context does.
