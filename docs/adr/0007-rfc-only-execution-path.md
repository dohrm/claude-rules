# ADR-0007: Make the feature RFC the only execution path

- **Status**: Accepted
- **Date**: 2026-10-05

## Context

ADR-0006 added `/rfc` next to `/plan` → `/tasks` → `/goal-setup` or `/loop-setup`,
and refused to retire the chain until both paths were measured. The maintainer
chose a breaking `next` line instead: two execution paths double the skills to
maintain (about 590 lines for the three framing skills) and the vocabulary agents
must learn, and the RFC's granularity verdict already splits large work into ordered
units. The chain also anchors the coherent block, `docs-check`, `publish-summary` and
`worktree-status` on the sprint, a unit the RFC replaces.

## Decision

We will make `/rfc` the only path from a framed feature to autonomous execution.

- `/plan`, `/tasks` and `/goal-setup` are removed. Capability-scale work gets an
  ordered list of RFCs from the granularity verdict, recorded in the first RFC.
- The coherent block of `agent/autonomy.md` is the RFC, not the sprint. Tier 3 runs
  once per RFC, before the push.
- On Codex, `/rfc` at L3 starts a `/goal` whose stopping condition is the RFC's.
- `/loop-setup` stays for repeated work with a measurable done-command, independent
  of any RFC. Its state file no longer extends a worklist.
- Kit tooling reads `.work/<slug>/rfc.md` and `loop.md`; it stops reading `PLAN.md`,
  task worklists and `goal.md`.

## Consequences

Existing `.work/` plans and worklists are no longer maintained by any skill: finish
or rewrite them as RFCs. The RFC size criterion is now unmeasured with no fallback
path, so the eval harness needs an RFC case. The ordering of several RFCs lives in
prose, not in a dedicated document.

## Alternatives considered

- Keep both paths (ADR-0006): two vocabularies and twice the skills, for a comparison nobody schedules.
- Keep `/plan` above `/rfc`: a second framing document for what the verdict already lists.
- Drop `/loop-setup` too: repeated chores (lint sweeps, migrations) are not features.
