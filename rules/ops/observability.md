---
paths:
  - "**/*.rs"
  - "**/*.go"
  - "**/*.py"
  - "**/*.ts"
title: "Ops — Observability"
---

Observability is the ability to answer a question you did not anticipate, about a
request you cannot reproduce. It is not "we have logs".

The language rules own **how** to emit (`rust/logging.md`, `go/logging.md`: levels,
structured fields, the handling boundary, never a secret). This rule owns the
invariants that fire while you are writing a handler, a consumer or a cron. The cost
model, the sampling and retention policy and the semantic-conventions detail are
`/observability`.

## Cardinality is the bill

A metric's cost is the number of distinct label combinations. **Never label with an
unbounded value**: user id, request id, session, email, raw URL path, error message,
SQL string. One such label turns one time series into millions, and the first thing
the platform does is drop your data or bill you for it.

- Labels take values from a **closed, small set**: route *template* (`/users/{id}`,
  never `/users/42`), method, status class, dependency name, region, version.
- Need the unbounded detail? That is a log line or a trace attribute, correlated by
  id — that is exactly what they are for.
- A metric you cannot name a consumer for (a dashboard, an alert, a report) is
  deleted. Same for a dashboard nobody opens.

## The minimum set

Instrument these, everywhere, before anything bespoke:

- **Every inbound request** — RED: rate, errors, duration. As a **histogram**, never
  an average: an average latency hides the tail that users actually feel.
- **Every outbound call** — same three, labelled by the dependency. Most incidents
  are someone else's incident arriving through your process.
- **Every queue and consumer** — depth, lag, retries, dead-letter count.
- **Every scheduled job** — a *last success* timestamp. The failure mode of a cron is
  silence, and only a staleness check catches it.
- **The handful of business events** that make the product legible (orders placed,
  sessions logged, invoices sent) — what lets you tell "the system is up" from "the
  product is working".

## Traces and correlation

- **One trace per request that crosses a boundary**, propagated with W3C
  `traceparent` — inbound, and outbound to every dependency and every queue message.
  A trace that stops at your process boundary answers nothing.
- **A span per boundary crossing**, not per function: handler, DB query, HTTP call,
  cache, queue publish/consume. Entry points, not hot inner loops.
- **One correlation id**, returned to the client in the error contract
  (`backend/errors.md`), present on every log line of that request, and equal to the
  trace id wherever the platform allows. One id the user can quote and support can
  search.
- **Always sample what is interesting** — errors, and anything slower than the SLO
  threshold. A tracing setup that drops the failures has inverted its own purpose.

## Rules

- **Emit through OpenTelemetry (OTLP)** and let the collector fan out; the vendor is
  a deployment concern. **Never a vendor SDK in domain code** — telemetry is an
  adapter, like the database (`hexagonal/principle.md`).
- **Resource attributes set once** at startup: service name, version, environment,
  instance. Everything downstream groups by these; they are not optional.
- **No secret, no personal data** in a log, a label, a span attribute or a metric
  name — the same prohibition as `backend/config.md`, applied to telemetry. A trace
  attribute is not a private space.
- **Emit at a boundary, once.** Duplicated instrumentation double-counts, and a
  double-counted error rate is worse than none.
- **Health probes are not observability** (`backend/health.md`): they say whether to
  route traffic, not what is wrong. Keep them out of request logs and metrics.
