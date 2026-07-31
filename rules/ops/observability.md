---
paths:
  - "**/*.rs"
  - "**/*.go"
  - "**/*.ts"
  - "**/*.tsx"
title: "Ops — Observability"
---

Observability is the ability to answer a question you did not anticipate, about a
request you cannot reproduce. It is not "we have logs".

The language rules own **how** to emit (`rust/logging.md`, `go/logging.md`: levels,
structured fields, the handling boundary, never a secret). This rule owns **what** to
emit, and how much.

## Three signals, three jobs

| Signal | Answers | Cost driver |
|---|---|---|
| **Logs** | what happened in *this one* event, in detail | volume × retention |
| **Metrics** | how the system behaves *in aggregate*, over time | **cardinality** |
| **Traces** | where the time went, across boundaries, for *this* request | sampling rate |

They are not substitutes. Counting errors by grepping logs is a metric done
expensively and badly; putting a request id in a metric label is a log done
catastrophically.

## Cardinality is the bill

A metric's cost is the number of distinct label combinations. **Never label with an
unbounded value**: user id, request id, session, email, raw URL path, error message,
SQL string. One such label turns one time series into millions, and the first thing
the platform does is drop your data or bill you for it.

- Labels are for values from a **closed, small set**: route *template*
  (`/users/{id}`, never `/users/42`), method, status class, dependency name, region,
  version.
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
  sessions logged, invoices sent). These are what let you tell "the system is up"
  from "the product is working".

## Traces and correlation

- **One trace per request that crosses a boundary**, propagated with W3C
  `traceparent` — inbound, and outbound to every dependency and every queue message.
  A trace that stops at your process boundary answers nothing.
- **A span per boundary crossing**, not per function: handler, DB query, HTTP call,
  cache, queue publish/consume. Same rule as the language instrumentation guidance —
  entry points, not hot inner loops.
- **One correlation id**, returned to the client in the error contract
  (`backend/errors.md`), present on every log line of that request, and equal to the
  trace id wherever the platform allows. One id the user can quote and support can
  search.
- **Sampling**: a low head-based rate is fine, but **always sample what is
  interesting** — errors, and anything slower than the SLO threshold. A tracing setup
  that drops the failures has inverted its own purpose.

## Instrument once, decide the backend later

Emit through **OpenTelemetry** (OTLP) and let the collector fan out. The vendor is a
deployment concern, not a code concern.

- **Never a vendor SDK in domain code.** Telemetry is an adapter, like the database
  — the domain does not import it (`hexagonal/principle.md`).
- **Resource attributes set once** at startup: service name, version, environment,
  instance. Everything downstream groups by these; they are not optional.
- Follow OTel **semantic conventions** for names and attributes instead of inventing
  a private vocabulary — the dashboards and alerts you did not write depend on it.

## Rules

- **No secret, no personal data** in a log, a label, a span attribute or a metric
  name — the same prohibition as `backend/config.md`, applied to telemetry. A trace
  attribute is not a private space.
- **Health probes are not observability** (`backend/health.md`): they say whether to
  route traffic, not what is wrong. Keep them out of request logs and metrics.
- **Emit at a boundary, once.** Duplicated instrumentation double-counts, and a
  double-counted error rate is worse than none.
- **Sampling and retention are decisions**, not defaults left to a vendor's free
  tier. Write down which, and what it costs.

## Checklist

- [ ] RED on every inbound request and every outbound dependency, as histograms
- [ ] No unbounded label anywhere; route templates, not concrete paths
- [ ] Queues expose lag/depth; every scheduled job exposes a last-success timestamp
- [ ] `traceparent` propagated in and out, span per boundary crossing
- [ ] One correlation id, returned to the client and on every log line
- [ ] Errors and slow requests always sampled
- [ ] OTLP out, no vendor SDK in domain code, resource attributes set at startup
- [ ] Every metric and dashboard has a named consumer; the rest is deleted
