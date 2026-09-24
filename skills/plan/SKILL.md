---
name: plan
description: "Open ONE PRD capability and break it into independently shippable sprints (tracer bullets), elaborating stub User Stories against the real code first. Writes `.work/<capability-slug>/PLAN.md` — committed, ephemeral. Use on /plan, \"slice this into sprints\", \"tracer bullets\". Upstream of /tasks."
---

Open **one** PRD capability and break it into independently shippable sprints as
vertical slices (tracer bullets). Output to `.work/<capability-slug>/PLAN.md` —
this is working memory, not a PRD-shaped living document: committed so a PR can
point at it, deleted once every sprint under this capability has shipped
(`product/documents.md`). Never the whole PRD at once — a capability not being
worked yet stays a stub; elaborating it now would be as speculative as `/tasks`
naming a file before its phase starts.

**Autonomy** (`agent/autonomy.md` § Levels): take the level from the argument, else
from an existing `.work/<slug>/PLAN.md` header, else **L1**. It changes only the
checkpoints marked *L1 / L2 / L3* below; every other step runs identically. A level
passed as an argument is written into the plan header — the header is what the next
run reads.

## Process

### 1. Get the capability

Read `docs/PRD.md`'s capability table. Take the capability named as an argument,
else ask which one. Read its unit (`docs/prd/NN-<slug>.md`, or the inline block
below the split threshold) — that capability, not the rest of the PRD.

**The capability-slug is that unit's own filename slug, numbers included** —
`NN-<slug>` from `docs/prd/NN-<slug>.md` (e.g. `02-parcel-state`), never a
shortened form invented on the spot. It sorts, and it's derivable with zero
judgment call — that's the whole point of pinning it here.

### 2. Elaborate the User Stories, if they're still a stub

If the capability's `## User Stories` is only the one or two stories `/prd` left
as a cadre, elaborate the full set now, against the **real code** — this is
brownfield work, not `/interview`'s greenfield framing. Map the open questions as a
tree, as `/interview` documents — but dispatch to explore the codebase and
`CONTEXT.md` for facts rather than asking the user for anything findable.

Write the resolved stories back into the **same** capability-unit file — never a
separate spec file; the capability unit is the one home for this fact
(`product/documents.md`). Update `CONTEXT.md` inline as vocabulary resolves
(`domain-modeling`).

If the stories are already complete (a re-open, or `/prd` wrote them in full),
skip this step.

The stories are scope, so the human validates them **at every level** — only the
rhythm changes:

- *L1* — `/interview`'s round / frontier mechanic: ask the whole frontier in one
  round, a recommendation on each, recompute and repeat until the frontier is empty.
- *L2 / L3* — settle every question the code or `CONTEXT.md` answers by taking your
  own recommendation, and record each one under the plan's `## Assumptions`. Ask the
  remaining ones — and validation of the whole set — in **one** round, no repeat.

### 3. Extension mode if this capability's plan already exists

If `.work/<slug>/PLAN.md` already exists, read it and only the sprints still
open. Spot User Stories not yet covered by an existing sprint. **Never rewrite a
shipped sprint** — it records what was promised, not what was built. Propose
additional sprints, and flag contradictions to the user before writing.

### 4. Explore the codebase

If you haven't already explored the codebase, do it to understand the current architecture, the patterns in place, and the integration layers. Skip this step for a greenfield project.

### 5. Identify durable architectural decisions

If `docs/ARCHITECTURE.md` exists (produced by `/architect`), the plan header is a **pointer, not a copy**: one line per decision with its ADR link, ~10 lines total. Restating an ADR's reasoning in the plan creates a second home for it, and the copy is the one that goes stale. Otherwise, identify the high-level decisions that should not move during implementation:

- Route structure / URL patterns
- Database schema shape
- Key data model names
- Authentication / authorization approach
- Third-party service boundaries

These go in the plan header; each sprint can refer to them.

### 6. Draft the vertical slices

Break the capability into **tracer-bullet** sprints. Each sprint is a thin slice that traverses ALL integration layers end-to-end, NOT a horizontal slice of a single layer.

<vertical-slice-rules>
- Each slice delivers a narrow but COMPLETE path through all layers (schema, API, UI, tests)
- A finished slice is demonstrable or verifiable on its own
- Prefer many thin slices over few thick ones
- Do NOT include file names, function names, or implementation details likely to change
- DO include the durable decisions: routes, schema shapes, model names
</vertical-slice-rules>

If the capability is already sprint-sized — the whole thing fits one `/tasks` +
`/loop-setup` pass — one sprint is correct. Don't invent a second for ceremony.

### 7. Validate the breakdown — when depends on the level

The breakdown is a numbered list. For each sprint:

- **Title**: short descriptive name
- **Blocked by**: other sprints that must finish first
- **User stories covered**: the capability's US-n numbers

The questions are always the same — is the granularity right (too coarse / too
fine)? are the dependencies correct? any sprints to merge or split further? Only
*when* they are asked changes:

- *L1* — present the breakdown and ask **before writing anything**. Iterate until
  validated, then go to step 8.
- *L2* — write the plan first (step 8), then present the breakdown and ask **once**.
  Apply the corrections to the written plan; no second round.
- *L3* — write the plan (step 8) and **do not ask**: the cut is working memory,
  amendable at any turn. Record the granularity and dependency calls you made under
  `## Assumptions`. A sprint that needs an acceptance criterion no validated story
  supports is a hard checkpoint — stop there.

### 8. Write the plan

Create `.work/<slug>/` if absent. One file, `.work/<slug>/PLAN.md` — the header,
then each sprint as `<sprint-unit>` under `## Sprint N: …`. No unit/index split: the
file dies with the capability, so the growth machinery `product/documents.md`
reserves for durable docs does not apply.

In extension mode, add sprints; never touch a shipped one. Confirm what was written.

### 9. Hand off to /tasks

A sprint is a promise, which is why nothing here names a file or a symbol. Turning ONE
sprint into something an agent can execute — anchors in the real code, tasks cut at the
green boundary, a branch — is `/tasks`, at the moment that sprint starts. Not now, and
not for every sprint at once: the code will have moved. At *L3*, when the human asked
for the chain, run `/tasks L3` on the first startable sprint yourself instead of stopping;
it continues through `/loop-setup`, which launches the loop.

Once every sprint under this capability ships, delete `.work/<slug>/` and
re-run `/prd` to flip the capability's status to `Shipped` — the plan's job is
done; the PRD's status column and the git log are what still answer "is this
built" from then on.

<plan-template>
<!-- `.work/<slug>/PLAN.md` — committed, ephemeral: dies once every sprint ships. -->
# Plan: <capability name>

> Source: `docs/prd/NN-<slug>.md` · Architecture: `docs/ARCHITECTURE.md`

- **Autonomy**: L1 | L2 | L3

## Where we are

Two or three sentences: what is shipped, what is in progress, what the next sprint unlocks.

## Durable decisions

One line each, with the ADR link — **pointers, never copies**:

- **<decision>** — <one line> ([ADR-NNNN](../../docs/adr/NNNN-<slug>.md))

## Sprints

| # | Sprint | Status | Ships | Blocked by |
|---|--------|--------|-------|------------|
| 01 | <title> | Shipped 2026-01-31 | <one line> | — |
| 02 | <title> | In progress | <one line> | 01 |
| 03 | <title> | Planned | <one line> | 02 |

## Out of the plan, for now

What was considered and deliberately left out, one line each — this capability's
Out of Scope items that keep coming back as questions.

## Assumptions

<!-- L2/L3 only — omit at L1. One line per question settled without asking: the
     question, the answer taken, what it was read from. The human reads this list
     instead of being asked; an unrecorded assumption is a silent scope change. -->
- <question> → <answer taken> (<source: code path, CONTEXT.md, ADR>)
</plan-template>

<sprint-unit>
<!-- ~400 words. One sprint, one vertical slice. As a `## Sprint N: …` block inside
     `.work/<slug>/PLAN.md`. -->
## Sprint NN: <title>

- **Status**: Planned | In progress | Shipped <YYYY-MM-DD>
- **Blocked by**: <sprint(s)>, or *None — startable immediately*
- **User stories**: <US-n from this capability>

## What we ship

The end-to-end behavior of this slice, from the user's side. Not the layer-by-layer implementation, no file or function names.

## Acceptance criteria

- [ ] <observable, verifiable — an event, an output, a measure>

<!-- Once Shipped, this block is frozen: it records what was promised. What was
     actually built and diverged goes in the ADR's `Implemented` section or in a
     later sprint — never as a quiet edit here. -->
</sprint-unit>
