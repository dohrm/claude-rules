---
name: plan
description: "Break a PRD into independently shippable phases as vertical slices (tracer bullets), then produce or extend `docs/PLAN.md` following a fixed template (durable architectural decisions + phases with user stories, deliverable, acceptance criteria, blockers). Use on /plan, \"break down the PRD\", \"write the implementation plan\", \"slice this into phases\", \"vertical slices\", \"tracer bullets\", or whenever a PRD must become a versioned execution plan. Natural downstream of /prd."
---

Break a PRD into independently shippable phases as vertical slices (tracer bullets). Output to `docs/PLAN.md`.

## Process

### 1. Get the PRD

Default: read `docs/PRD.md`. If a file path is passed as an argument, read it. If nothing usable, ask the user to point at the file or paste the content.

### 2. Extension mode if a PLAN already exists

If `docs/PLAN.md` already exists, read it. Spot the PRD user stories not yet covered by an existing phase, and inconsistencies with a PRD that has moved. Do not rewrite already-validated phases; propose additional phases or targeted extensions, and flag contradictions to the user before writing.

### 3. Explore the codebase

If you haven't already explored the codebase, do it to understand the current architecture, the patterns in place, and the integration layers. Skip this step for a greenfield project.

### 4. Identify durable architectural decisions

Before slicing, identify the high-level decisions that should not move during implementation:

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

Create `docs/` if absent. Write `docs/PLAN.md` using the template. In extension mode, integrate the additional phases alongside the existing ones without touching already-validated content. Confirm *"✓ written to `docs/PLAN.md`"*.

<plan-template>
# Plan: <feature name>

> Source PRD: <path or identifier>

## Architectural Decisions

Durable decisions that apply to every phase:

- **Routes**: ...
- **Schema**: ...
- **Key models**: ...
- (add/remove sections per context)

---

## Phase 1: <title>

**User stories**: <list from the PRD>

### What we ship

Concise description of this vertical slice. Describe the end-to-end behavior, not the layer-by-layer implementation.

### Acceptance criteria

- [ ] Criterion 1
- [ ] Criterion 2
- [ ] Criterion 3

## Blocked by

- Reference to the blocking phase (if any)

Or *"None — startable immediately"* if there is no blocker.

---

## Phase 2: <title>

**User stories**: <list from the PRD>

### What we ship

...

### Acceptance criteria

- [ ] ...

## Blocked by

- ...

<!-- Repeat for each phase -->
</plan-template>
