# ADR-0006: Offer an iterated feature RFC as a lighter execution path

- **Status**: Proposed
- **Date**: 2026-10-05

## Context

Today a feature reaches autonomous execution through `/plan` → `/tasks` →
`/goal-setup` or `/loop-setup`: three documents, three human validations, about 760
lines of skills, framed for implementers that need everything spelled out. ADR-0004
already lets frontier models run a whole sprint per turn. ADR-0005 moves
feature-local choices out of ADRs and needs a place to put them. The maintainer wants
to spend review on the feature's engineering, iterating with one agent on one
document, then let the agent implement it.

## Decision

We will add `/rfc`, a feature RFC under `.work/<slug>/rfc.md`, next to the current chain.

- Contents: goal, scope and non-scope, local decisions with their reasons, execution
  steps each with its proof, stopping condition, open questions.
- The first output is a granularity verdict: one RFC, split into N RFCs, or a product
  question for `/interview`.
- Proposed size: one autonomous run, one stopping condition, one reviewable PR. If the
  end proof cannot be stated in a few lines, split.
- Iteration: the agent drafts, the human comments, the agent revises. Statuses:
  `draft` → `ready` → `implementing` → `done`. Only the human sets `ready`.
- At `ready`, the agent implements under the declared autonomy level (ADR-0004). The
  gate and hard checkpoints are unchanged.
- The RFC is ephemeral like the rest of `.work/`. `CONTEXT.md` defines RFC as this
  document; ADR stays the durable arbitration.

## Consequences

The size criterion is unvalidated: it needs a real feature run both ways before either
path is retired. Two execution paths must be maintained until then. Local decisions are
reviewed once, at `ready`, not one by one. A feature larger than one RFC needs
several, with nothing yet ordering them besides the human.

## Alternatives considered

- Extend `/solution-exploration`: it compares options for one problem and has no execution steps.
- Replace `/plan` and `/tasks` outright: unmeasured, and capability-scale work still needs slicing.
- Keep local decisions in ADRs: the cascade ADR-0005 measured.
