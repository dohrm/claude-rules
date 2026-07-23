---
name: prd
description: "Frame a project through structured questioning and produce or extend `docs/PRD.md` following a fixed 8-section template (Problem, Solution, Target User, User Stories, Success Criteria, Out of Scope, Implementation Decisions, Additional Notes). Use on /prd, \"frame this project\", \"write the PRD\", \"create/extend the PRD\", \"produce the PRD\", or whenever a project's framing must be captured in a versioned document. Natural pair of /interview (upstream) and /plan (downstream)."
---

You question the user to produce or extend `docs/PRD.md` using the template below.

## Process

1. Explore the repo if needed to understand existing context (`CLAUDE.md`, ADRs, domain glossary, adjacent code). Reuse the project's vocabulary in the PRD and respect architectural decisions already made. If the answer to a question is in the repo, explore instead of asking.

2. If `docs/PRD.md` exists, read it. Cross-check against the incoming brief and only question the deltas. Confront contradictions: *"You'd settled on X, the brief suggests Y — which do we keep?"*. No PRD and no brief → your first question is *"What do you want to frame?"*.

3. Ask one question at a time, with your justified recommendation. Follow the dependencies: Problem → Target User → Solution → Success Criteria → Out of Scope. User Stories and Implementation Decisions emerge across the others. Before moving on, ask *"Anything for Additional Notes: risks, dependencies, assumptions?"*.

4. When every section can be written with no gaps, say so in one sentence and write the full PRD in the chat using the template. User Stories are synthesized at this point from the other answers and presented for validation.

5. The user validates or corrects section by section. On a correction, re-post only the affected section. Once everything is validated, write `docs/PRD.md` (create `docs/` if needed) and confirm *"✓ written to `docs/PRD.md`"*.

<prd-template>

## Problem

What the user lives through: frustration, context, "why now". Prose in the third person, not in *I*.

## Solution

Product direction from the user's point of view: what the product lets them do, not how it's built.

## Target User

Profile + usage context, precise enough to picture a real person.

## User Stories

Exhaustive numbered list in the form *"As a `<actor>`, I want `<capability>`, so that `<benefit>`"*. Cover the main interactions, empty states, errors, alternative paths, edge cases.

## Success Criteria

Directly verifiable criteria: an observable event (a click, a produced file, a received email) or an objective measure (duration, count, threshold). No judgment of inner behavior ("understands X", "identifies Y").

## Out of Scope

What we explicitly refuse. Exhaustive — this is what guards against over-engineering.

## Implementation Decisions

User-visible product behavior (numeric limits, empty states, display format, UX choices, form factor, errors). No internal technical detail (algorithms, formulas, env vars, library names, tech categories). Mental test: if the user can't observe the difference in use, it's excluded.

## Additional Notes

Catch-all: risks, external dependencies, assumptions, references, future items. Keep it short; *"Nothing to report."* if empty.

</prd-template>

## Rules

- Vocabulary = the user's, verbatim.
- No named technology, no gaps, no file path, no code snippet in the PRD.
- User Stories must be numbered: US-1, US-2 …
