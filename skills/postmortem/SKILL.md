---
name: postmortem
description: "Blameless incident retrospective: timeline from evidence, detect/mitigate/resolve separately, contributing factors not one root cause. Writes `docs/postmortem/<YYYY-MM-DD>-<slug>.md` and hands off deltas — never edits the targets. Use on /postmortem, \"incident review\", \"RCA\", \"we had an outage\". Mirror of /pre-mortem."
---

An incident already happened. Your job is to make **this class of failure** less likely,
faster to detect, or cheaper to survive — and to do it without spending the goodwill
that makes people report incidents honestly.

Two rules govern everything below:

- **Blameless.** Everyone acted reasonably given what they knew at the time. The target
  is the system that made the wrong action look right. *"Human error"* is never a cause;
  it is a system that permitted it. **Roles, never names** — "the on-call engineer", "the
  author of the change" — including in the timeline, including when the sentence is
  praise. An incident document travels far beyond the room it was written in, and a name
  in it is read as an attribution by everyone who was not there.
- **No single root cause.** A complex system fails through several factors that were
  each individually survivable. "The" root cause is a comforting fiction that stops the
  investigation at the first plausible stop.

Output: `docs/postmortem/<YYYY-MM-DD>-<slug>.md`. You own that directory and nothing
else — every fix that touches another document is emitted as a **delta** and handed off
(same discipline as `/pre-mortem`).

## Process

### 1. Frame

- **Does this incident earn a postmortem?** Yes if it burnt meaningful error budget,
  was user-visible, or was a **near miss that only luck contained** — near misses are
  the cheapest lessons available. No for a routine alert with a known runbook that
  worked. Say which, and stop if the answer is no.
- Write it **while memory is fresh** — within days. A postmortem written in a month is
  a reconstruction, and it will be tidier and less true.
- Read what exists: `docs/OBSERVABILITY.md` (what should have alerted), the runbooks
  used, `ops/slo.md` for the budget, and the ADRs the incident touches.

### 2. Rebuild the timeline from evidence, not memory

Pull it from what is recorded: alert firings, deploy and release events, commits and
merges, migration runs, flag changes, dashboards, the correlation ids in the logs. Mark
anything unverified as **assumed** rather than smoothing it into the narrative.

Then extract the three numbers that actually drive the action items:

| | Meaning | Improved by |
|---|---|---|
| **Time to detect** | start → someone knew | alerting (`/observability`) |
| **Time to mitigate** | knew → users stopped hurting | runbooks, kill switches, rollback |
| **Time to resolve** | knew → cause fixed | the fix itself |

A long detect time and a short mitigate time is a monitoring problem. The reverse is an
operational-readiness problem. They lead to different work — which is why they are never
reported as one duration.

### 3. Contributing factors, and what saved you

- List the factors, each with the evidence for it. Include the ones that are
  uncomfortable and structural: a gate that was bypassed, an alert that was muted, a
  flag with no owner, a migration that locked, an ADR whose assumption had quietly
  expired.
- **Counterfactual discipline**: no *"if only X had…"* unless X was knowable at the
  time with the information available. Hindsight bias produces action items that
  protect against the past.
- **What went right** — the controls that limited the damage. Name them, because the
  next quarter's cleanup will otherwise delete one of them.

### 4. Turn each lesson into a system change

Every action item is a change to the **system**, with an **owner** and a **date**.
*"Be more careful"*, *"add documentation"* and *"communicate better"* are not action
items. Classify each by what it buys, because that is what makes the list arguable:

| Class | Example |
|---|---|
| **Prevent** | a gate, a type, a constraint, a limit, a migration rule |
| **Detect faster** | an alert, an SLI, a staleness check |
| **Mitigate faster** | a runbook, a kill switch, a rehearsed rollback |

Then hand each off — never edit the target yourself:

- a gate or a check → the kit / CI (`cicd/pipeline.md`)
- a convention → a rule
- an alert or an SLI → `/observability`
- a first move → `/runbook`
- a design change → an ADR via `/architect` (`Proposed`; a human accepts it)
- scope or sequencing → `/prd`, `/plan`

Prefer **one prevent + one detect + one mitigate** over ten items nobody will do. A list
longer than five is a list that will be closed unread.

### 5. Write, then hand back

Write the file with `<postmortem-template>` — one screen per section
(`product/documents.md`). Hand back: the three durations, the factors, the handed-off
deltas, and what a human must decide (the budget-policy consequence, whether an action
item is worth the cost, who owns each date).

<postmortem-template>
<!-- ~800 words plus the timeline table. Past that the analysis has become an essay:
     the factors are being argued rather than stated, or an action item is being
     designed here instead of in the ADR it was handed off to. -->
# Postmortem — <what broke>, <YYYY-MM-DD>

- **Impact**: <who was affected, for how long, what they could not do>
- **Error budget**: <consumed / remaining, per `ops/slo.md`>
- **Detect / mitigate / resolve**: <Xm / Ym / Zh>
- **Status**: Draft | Reviewed <date>

## What happened

Three or four sentences, plainly. No jargon a new joiner would not follow.

## Timeline

| Time (UTC) | Event | Source |
|---|---|---|
| 00:00 | <trigger> | <deploy / commit / alert / log> |

Mark anything not backed by a record as **assumed**.

## Contributing factors

- **<factor>** — <evidence>. <why the system allowed it>

## What went right

- <the control that limited the damage — protect it>

## Action items

| # | Change | Class | Owner | By |
|---|--------|-------|-------|----|
| 1 | <a change to the system> | prevent / detect / mitigate | <who> | <date> |

## Deltas handed off

- **`/runbook`** — <the runbook to write or fix>
- **`/observability`** — <the alert or SLI>
- **ADR** — <the decision to revisit, and why its assumption expired>
</postmortem-template>

## Never

- Name a person as a cause, or write an action item that asks someone to try harder.
- Report one duration instead of detect / mitigate / resolve.
- Settle on one root cause because it is the first one that explains the symptom.
- Accept an action item with no owner or no date — an unowned item is a wish.
- Edit the PRD, an ADR, a rule or a runbook yourself: emit the delta, hand it off.
- Write the postmortem *instead of* mitigating. Service first, always.
