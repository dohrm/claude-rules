# ADR-0011: The RFC is the only execution path, with no separate loop skill

- **Status**: Proposed
- **Date**: 2026-11-12

## Context

ADR-0007 made `/rfc` the only path from a framed feature to execution, and kept
`/loop-setup` for repeated chores with a measurable done-command. That skill was an
external loop around a model that could not hold one: preconditions, caps and a state
file re-read every turn.

Since `/rfc` shipped, the maintainer no longer uses it. Frontier models (Opus 5.5,
gpt-6.1-sol) run that loop inside one `/rfc` run and orchestrate sub-agents themselves.
The skill still costs: about 2,000 words, 12 mentions in the always-loaded
`agent/autonomy.md`, a `loop.md` branch in `publish-summary` and `worktree-status`,
and an accepted audit finding (its done-command is neither frozen nor run first) that
would have to be fixed in an asset nobody runs.

## Decision

We will keep `/rfc` as the only execution path and remove `/loop-setup`. This record
supersedes ADR-0007 once accepted.

- `/rfc` stays the only path from a framed change to autonomous execution, one RFC per
  request, decomposed into phases and holds, as ADR-0007 decided and amended.
- `/loop-setup`, its `loop-setup` profile and the `loop.md` state file are removed. A
  repeated chore with a measurable end is an RFC whose stopping condition is that
  command.
- Kit tooling reads `.work/<slug>/rfc.md` and `defect.md` only.
- The `loop-setup` profile is retired in the registry, so `update` drops it from a
  lock and says why.
- On Codex, `/rfc` at L3 still starts a `/goal` on the RFC's stopping condition.

## Consequences

A model that cannot hold the loop by itself gets no external one from this library:
running a weaker model on chores means writing that scaffold again, from measurements.
An existing `loop.md` in a consuming repo is no longer read by `just status` or
`publish-summary`; its owner finishes it or rewrites it as an RFC. The eval harness
still needs an RFC case, as ADR-0007 already noted.

## Alternatives considered

- Keep `/loop-setup` and fix its done-command: maintenance paid for a skill with no user.
- Keep the skill unlisted, as an opt-in archive: git already is the archive, and an unmaintained skill drifts from the rules it cites.
- Keep both `/plan`-style and RFC paths (refused by ADR-0007): two vocabularies and twice the skills, for a comparison nobody schedules.
- Extend `/solution-exploration` instead of `/rfc` (refused by ADR-0007): it compares options and has no execution steps.
