---
name: plan
description: "Break a PRD into independently shippable phases as vertical slices (tracer bullets), then produce or extend `docs/PLAN.md` following a fixed template (durable architectural decisions + phases with user stories, deliverable, acceptance criteria, blockers). Use on /plan, \"break down the PRD\", \"write the implementation plan\", \"slice this into phases\", \"vertical slices\", \"tracer bullets\", or whenever a PRD must become a versioned execution plan. Natural downstream of /prd."
---

Break a PRD into independently shippable phases as vertical slices (tracer bullets). Output to `docs/PLAN.md`.

## Process

### 1. Get the PRD

Default: read `docs/PRD.md`. If a file path is passed as an argument, read it. If nothing usable, ask the user to point at the file or paste the content.

### 2. Extension mode if a PLAN already exists

If `docs/PLAN.md` (or `docs/plan/`) already exists, read the index and only the phases still open. Spot the PRD user stories not yet covered by an existing phase, and inconsistencies with a PRD that has moved. **Never rewrite a shipped phase** — it records what was promised, not what was built. Propose additional phases, and flag contradictions to the user before writing.

**A plan is meant to grow — the file is not.** Growth arrives as a new phase *unit*, never as more prose inside an existing one (`product/documents.md`). If the plan is a single file and is now past ~6 phases or ~400 lines, propose the split before adding anything:

> *"The plan is at N phases / L lines. I'd split it: `docs/plan/NN-<slug>.md` per phase, `docs/PLAN.md` becomes the phase table. Shipped phases move as-is. Go?"*

Do the migration mechanically — one file per existing phase, content unchanged — then add the new phases as units.

### 3. Explore the codebase

If you haven't already explored the codebase, do it to understand the current architecture, the patterns in place, and the integration layers. Skip this step for a greenfield project.

### 4. Identify durable architectural decisions

If `docs/ARCHITECTURE.md` exists (produced by `/architect`), the plan header is a **pointer, not a copy**: one line per decision with its ADR link, ~10 lines total. Restating an ADR's reasoning in the plan creates a second home for it, and the copy is the one that goes stale. Otherwise, identify the high-level decisions that should not move during implementation:

- Route structure / URL patterns
- Database schema shape
- Key data model names
- Authentication / authorization approach
- Third-party service boundaries

These go in the plan header; each phase can refer to them.

### 5. Draft the vertical slices

Break the PRD into **tracer-bullet** phases. Each phase is a thin slice that traverses ALL integration layers end-to-end, NOT a horizontal slice of a single layer.

<vertical-slice-rules>
- Each slice delivers a narrow but COMPLETE path through all layers (schema, API, UI, tests)
- A finished slice is demonstrable or verifiable on its own
- Prefer many thin slices over few thick ones
- Do NOT include file names, function names, or implementation details likely to change
- DO include the durable decisions: routes, schema shapes, model names
</vertical-slice-rules>

### 6. Quiz the user

Present the breakdown as a numbered list. For each phase:

- **Title**: short descriptive name
- **Blocked by**: other slices that must finish first
- **User stories covered**: the PRD user-story numbers

Then ask:

- Is the granularity right? (too coarse / too fine)
- Are the dependencies correct?
- Any phases to merge or split further?

Iterate until validated.

### 7. Write the plan

Create `docs/` if absent. **Two shapes, one threshold** (`product/documents.md`):

- **Up to ~6 phases** — one file, `docs/PLAN.md`: the header, then each phase as `<phase-unit>` under an `## Phase N: …` heading. A directory for three phases is ceremony.
- **Beyond that** — `docs/PLAN.md` becomes the index (`<plan-index-template>`), one file per phase in `docs/plan/NN-<slug>.md` (`<phase-unit>`).

In extension mode, add units; never touch a shipped phase. Confirm what was written and, if you migrated, that the phase contents moved unchanged.

<plan-index-template>
# Plan: <project name>

> Source PRD: `docs/PRD.md` · Architecture: `docs/ARCHITECTURE.md`

## Where we are

Two or three sentences: what is shipped, what is in progress, what the next phase unlocks. This is the paragraph someone reads instead of the whole plan.

## Durable decisions

One line each, with the ADR link — **pointers, never copies**:

- **<decision>** — <one line> ([ADR-NNNN](./adr/NNNN-<slug>.md))

## Phases

| # | Phase | Status | Ships | Blocked by |
|---|-------|--------|-------|------------|
| [01](./plan/01-<slug>.md) | <title> | Shipped 2026-01-31 | <one line> | — |
| [02](./plan/02-<slug>.md) | <title> | In progress | <one line> | 01 |
| [03](./plan/03-<slug>.md) | <title> | Planned | <one line> | 02 |

## Out of the plan, for now

What was considered and deliberately left out, one line each — the PRD's Out of Scope items that keep coming back as questions.
<!-- Whole index: ONE screen. Rewritten in full on every update. Nothing here that
     would need editing when a phase file changes — status and blockers only. -->
</plan-index-template>

<phase-unit>
<!-- ~400 words. One phase, one vertical slice. As `docs/plan/NN-<slug>.md`, or as a
     section of PLAN.md below the split threshold. -->
# Phase NN: <title>

- **Status**: Planned | In progress | Shipped <YYYY-MM-DD>
- **Blocked by**: <phase(s)>, or *None — startable immediately*
- **User stories**: <US-n from the PRD>

## What we ship

The end-to-end behavior of this slice, from the user's side. Not the layer-by-layer implementation, no file or function names.

## Acceptance criteria

- [ ] <observable, verifiable — an event, an output, a measure>

<!-- Once Shipped, this file is frozen: it records what was promised. What was
     actually built and diverged goes in the ADR's `Implemented` section or in a
     later phase — never as a quiet edit here. -->
</phase-unit>
