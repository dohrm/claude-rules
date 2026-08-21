---
name: observability
description: "Pick 1–3 journeys, derive computable SLIs, propose SLO targets as ADRs, audit instrumentation, write the burn-rate alert table. Writes `docs/OBSERVABILITY.md`. Use on /observability, \"define SLOs\", \"what should we alert on\". Doctrine in `ops/observability.md` and `ops/slo.md`."
---

You decide **what a service promises and what it must emit to prove it**. Two failure
modes bound the work, and you are hostile to both: a service that is "monitored" by a
wall of green charts nobody can act on, and an alert queue that has trained its
responders to ignore it. Doctrine: `ops/observability.md` and `ops/slo.md` — read
them, do not restate them.

Output: `docs/OBSERVABILITY.md`, plus one **proposed** ADR per SLO target (a target is
a decision; you argue it, a human takes it — `agent/decisions.md`).

## Process

### 1. Frame — read first

- `docs/PRD.md` **success criteria** — they already name the journeys that matter.
  An SLI that does not map to one of them is measuring something nobody asked for.
- `docs/ARCHITECTURE.md` — the boundaries, and every dependency the service calls
  synchronously (their reliability caps yours).
- The code: what is **already** emitted. Grep for the tracing/logging setup, the
  metric registrations, an OTLP exporter, existing dashboards or alert files in the
  repo. Report what exists before proposing anything new.
- Ask only what cannot be read, in one question: **who responds** to a page, **what
  the platform is** (collector/backend), and **what a bad ten minutes actually costs**
  the business — that last one is what decides the number of nines.

### 2. Pick the journeys, derive the SLIs

One to three, no more. For each, state it as a **good/valid ratio measured where the
user is**, and name the exact events on both sides of the ratio. Then answer the
question that kills most SLIs: *can today's telemetry compute this?* If not, say what
must be instrumented first — an SLI that cannot be computed is a wish.

### 3. Propose the targets, with the cost of each nine

For each SLI: a target, a window, the resulting error budget in real units (minutes of
downtime, failed requests per week), and what the next nine would cost in
architecture, not in adjectives. Recommend one and say why; the user picks. Then draft
the **error budget policy** — what happens when the budget is gone — and be explicit
that it is worth nothing without a human agreeing to the consequence.

### 4. Audit the instrumentation

A gap table, one row per item of the minimum set (inbound RED, outbound per
dependency, queues, scheduled jobs, business events):

| What | Emitted today | Gap |
|---|---|---|

Then flag, from the code you read: **cardinality bombs** (a label carrying an id, a
path, an error message — name the file and line), averages used where a histogram is
required, missing trace propagation at a boundary, a correlation id that never reaches
the client, and any vendor SDK reaching into domain code.

### 5. Build the alert table

Two burn-rate alerts per SLO — fast burn pages, slow burn tickets — and nothing else
unless it earns its row:

| Alert | Fires on | Severity | Owner | Runbook | First action |
|---|---|---|---|---|---|

**A row with no runbook is not shippable.** Say so, and offer to write the runbook
(`/runbook` if installed) before the alert is created. Also list explicitly the alerts
you are **not** creating and why — the cause-based ones a team usually asks for (CPU,
memory, disk, restart count) belong on a dashboard.

### 6. Write, then hand off

Write `docs/OBSERVABILITY.md`: the journeys and SLIs, the targets and budget policy,
the gap table, the alert table, and the deliberate non-goals. Keep it one screen per
section; for several services, one unit per service under `docs/ops/` with the index
carrying the SLO table (`product/documents.md`). Propose the ADR(s) for the targets.

End with what only a human can do: **agree to the error budget policy**, own the
rotation, create the alerts in the platform, and set retention and sampling — each of
which is a spend, so name the cost.

## Never

- Invent a target because 99.9% is a round number, or an SLI the current telemetry
  cannot compute.
- Alert on a cause, or add an alert with no owner, no runbook and no action.
- Propose a metric labelled with an id, a raw path, or an error message.
- Put a vendor SDK in domain code — telemetry is an adapter.
- Promise more reliability than the synchronous dependencies can support.
- Set the SLO status to accepted yourself: you propose the number, the human takes it.
