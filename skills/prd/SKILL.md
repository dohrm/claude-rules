---
name: prd
description: "Frame a project through structured questioning and produce or extend `docs/PRD.md` following a fixed 8-section template (Problem, Solution, Target User, User Stories, Success Criteria, Out of Scope, Implementation Decisions, Additional Notes). Use on /prd, \"frame this project\", \"write the PRD\", \"create/extend the PRD\", \"produce the PRD\", or whenever a project's framing must be captured in a versioned document. Natural pair of /interview (upstream) and /plan (downstream)."
---

You question the user to produce or extend `docs/PRD.md` using the template below.

## Process

1. Explore the repo if needed to understand existing context (`CLAUDE.md`, ADRs, domain glossary, adjacent code). Reuse the project's vocabulary in the PRD and respect architectural decisions already made. If the answer to a question is in the repo, explore instead of asking.

2. If `docs/PRD.md` (or `docs/prd/`) exists, read the spine and the capabilities the brief touches. Cross-check against the incoming brief and only question the deltas. Confront contradictions: *"You'd settled on X, the brief suggests Y — which do we keep?"*. No PRD and no brief → your first question is *"What do you want to frame?"*.

   **The PRD is meant to grow — the file is not.** The spine (Problem, Solution, Target User, Success Criteria, Out of Scope) is *stable*: new scope almost never changes it, and it must stay one screen. Growth lands in a **capability unit**, never as more prose in a spine section and never as a `### … (continued)` heading (`product/documents.md`). If the PRD is a single file now past ~8 capabilities or ~400 lines, propose the split before adding:

   > *"The PRD is at N capabilities / L lines. I'd split it: one file per capability in `docs/prd/`, `docs/PRD.md` keeps the spine and gains the capability table. Content moves unchanged. Go?"*

3. Ask one question at a time, with your justified recommendation. Follow the dependencies: Problem → Target User → Solution → Success Criteria → Out of Scope. User Stories and Implementation Decisions emerge across the others. Before moving on, ask *"Anything for Additional Notes: risks, dependencies, assumptions?"*.

4. When every section can be written with no gaps, say so in one sentence and write the full PRD in the chat using the template. User Stories are synthesized at this point from the other answers and presented for validation.

5. The user validates or corrects section by section. On a correction, re-post only the affected section. Once everything is validated, write it (create `docs/` if needed) and confirm what was written.

   **Two shapes, one threshold** (`product/documents.md`): up to ~8 capabilities, everything in `docs/PRD.md` — the spine, then each capability as a `###` block. Beyond that, `docs/PRD.md` keeps the spine + the capability table and each capability becomes `docs/prd/NN-<slug>.md`.

<prd-template>
<!-- The SPINE. ~1000 words, each section ~200 max. It is the stable part: new scope
     lands in a capability, not here. -->

## Problem

What the user lives through: frustration, context, "why now". Prose in the third person, not in *I*.

## Solution

Product direction from the user's point of view: what the product lets them do, not how it's built.

## Target User

Profile + usage context, precise enough to picture a real person.

## Capabilities

One line per capability — the actor, the job it does for them, and where its detail lives. This table IS the compaction: it must be enough to see the whole product.

| # | Capability | For whom, and the job it does | Stories |
|---|-----------|-------------------------------|---------|
| [01](./prd/01-<slug>.md) | <name> | <one line> | US-1…4 |

## Success Criteria

Directly verifiable criteria: an observable event (a click, a produced file, a received email) or an objective measure (duration, count, threshold). No judgment of inner behavior ("understands X", "identifies Y"). Product-level only — a criterion that belongs to one capability lives with it.

## Out of Scope

What we explicitly refuse, one line each. Exhaustive — this is what guards against over-engineering.

## Additional Notes

Risks, external dependencies, assumptions. Keep it short; *"Nothing to report."* if empty. Not a place for deferred scope — that goes in Out of Scope.

</prd-template>

<capability-unit>
<!-- ~500 words. One capability. As `docs/prd/NN-<slug>.md`, or as a `###` block of
     PRD.md below the split threshold. -->
# <NN> — <capability name>

**For** <actor>, **so that** <the job it does for them>. <One or two sentences of context, only if the spine does not already carry it.>

## User Stories

*"As a `<actor>`, I want `<capability>`, so that `<benefit>`"* — numbered **US-n, unique across the whole PRD** (the plan references these numbers). Cover the main interactions, empty states, errors, alternative paths, edge cases.

## Behavior decisions

User-visible product behavior for this capability: numeric limits, empty states, display format, UX choices, errors. No internal technical detail (algorithms, env vars, library names). Mental test: if the user cannot observe the difference in use, it does not belong here.

**Anything architecturally significant is an ADR, not a line here** — link it rather than arguing it (`agent/decisions.md`).

## Out of scope for this capability

What this capability deliberately does not do, one line each — distinct from the product-level Out of Scope in the spine.
</capability-unit>

## Rules

- Vocabulary = the user's, verbatim.
- No named technology, no gaps, no file path, no code snippet in the PRD.
- User Stories must be numbered: US-1, US-2 … and the numbering is **global**, never restarted per capability.
- The spine stays one screen, and stays stable. Growth is a new capability unit — never a longer section, never a `(continued)` heading.
- **One home per fact** (`product/documents.md`): why-this-technical-choice is an ADR, what-it-looks-like is `EXPERIENCE.md`/`DATA-MODEL.md`, when-it-ships is the plan. The PRD carries what and why-anyone-cares, and links to the rest.
