---
paths:
  - "**/*.rs"
  - "**/*.go"
  - "**/*.ts"
  - "**/*.tsx"
title: "Ops — SLOs, Error Budgets & Alerting"
---

"Reliable" is not a feeling, and "as reliable as possible" is not a target — it is an
unbounded budget. An SLO turns reliability into a number someone agreed to, which is
what makes the trade-off against shipping features an actual decision.

## SLI — measured where the user is

An SLI is a **ratio of good events over valid events**, measured at the boundary the
user experiences: the edge, the API, the job's output. Not CPU, not memory, not queue
depth — those are causes, and they belong on a dashboard, never in an SLO.

Three shapes cover almost everything:

- **Availability** — successful responses / valid responses. A `4xx` caused by the
  client is *not* your error; a `5xx` and a timeout are.
- **Latency** — requests faster than a threshold / all requests. Pick the threshold
  from what the user notices, then measure the *ratio*, not the percentile. "99% under
  300 ms" is an SLI; "p99 latency" is a chart.
- **Freshness / correctness** — for pipelines and jobs: outputs produced within the
  window / expected outputs.

**One to three SLIs per service**, on the journeys the PRD's success criteria already
name. An SLO on everything is an SLO on nothing.

## SLO and error budget

An SLO is a target over a rolling window — *"99.9% of requests succeed over 30
days"*. Its complement is the **error budget**: the amount of failure you have
explicitly bought.

- **The budget is the point.** It says how much risk a release may spend, and it is
  the only honest way to answer "can we ship on Friday".
- **99.9% is not a default.** Each nine multiplies cost. Choose the number against
  what the product actually needs, from the PRD, and write the reasoning down — this
  is a decision, so it belongs in an ADR (`agent/decisions.md`), not in a dashboard
  config.
- **Error budget policy**, agreed in advance and by a human: when the budget is
  exhausted, the next work is reliability, not features. A budget with no consequence
  is a metric, not a commitment.
- **Missing the SLO is not an incident** by itself; burning the whole budget in an
  afternoon is.

## Alerting — on symptoms, and only if someone will act

- **Alert on the SLI burning, not on the cause.** High CPU with users served fine is
  a dashboard; 5% of requests failing is a page. Cause-based alerts fire for
  conditions that are sometimes normal, which is how a team learns to ignore alerts.
- **Multi-window burn rate**: fast burn (a large fraction of the budget in an hour) →
  **page**; slow burn (the budget trending to exhaustion over days) → **ticket**.
  Two windows, so a short spike does not page and a slow leak is not invisible.
- **Every alert carries three things**: an **owner**, a **runbook** link, and one
  **action** the responder can take. Missing any of the three, it is not an alert.
- **No alert without a runbook** (`/runbook` writes one). An alert that arrives with no
  stated first move costs the responder the time it took to write the runbook, every
  single time it fires.
- **Page only for user-visible and actionable-now.** Everything else is a ticket. A
  page at 3 a.m. that resolves itself is a bug in the alert.
- **An alert nobody acted on in six months is deleted.** Alert fatigue is not a
  personal failing — it is the predictable result of a queue of things that cry wolf,
  and it costs the credibility of the alerts that work.

## Rules

- The SLI is computed from the **same telemetry the service already emits**
  (`ops/observability.md`) — never from a separate probe that measures something
  slightly different.
- **Synthetic checks complement, never replace** real-traffic SLIs: they catch "up
  but broken with no users online", they do not represent what users experienced.
- **Dependencies have SLOs too**, and yours cannot exceed the composition of theirs.
  If a downstream promises 99.5%, promising 99.95% on a path that calls it
  synchronously is a promise made with someone else's money.
- **Review the numbers on a schedule.** An SLO nobody has looked at in a year
  describes a system that no longer exists.

## Checklist

- [ ] 1–3 SLIs per service, good/valid ratios, measured where the user is
- [ ] Each SLO's target is justified against the product and recorded in an ADR
- [ ] An error budget policy exists, agreed by a human, with a consequence
- [ ] Alerts fire on the SLI burning, not on causes
- [ ] Fast burn pages, slow burn tickets
- [ ] Every alert has an owner, a runbook and one action
- [ ] No page that is not user-visible and actionable now
- [ ] Alerts nobody acted on are deleted, not muted
