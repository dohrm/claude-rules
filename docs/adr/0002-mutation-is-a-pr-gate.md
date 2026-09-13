# ADR-0002: Mutation testing is a PR gate, not a pre-push step

- **Status**: Accepted
- **Date**: 2026-09-11

## Context

`rules/agent/autonomy.md` puts `just mutate-diff` in the agent's per-block loop, and
`kit/rust/mutation-ci.yaml` calls its CI job "the WITNESS, not the first
observation".

Measured on one Rust workspace, that loop step cost ~50 minutes on a 32-mutant
diff, and 19 minutes on a 65-mutant one after the kit's Tier 3 levers. It is
compile-bound, not test-bound: cargo-mutants builds a cold scratch copy, and a
third of those mutants were **unviable** — they do not compile, carry no signal,
and cost a full build each. Figures and levers: `kit/rust/README.md`.

Excluding the unviable set lands near 9 minutes, so wall-clock alone no longer
carries this decision. What carries it is that the remaining lever is `-j`: cores a
laptop cannot spend while the editor and the agent are using them, and a runner
can.

## Decision

We will run mutation as a **blocking gate on the pull request**, not as a step in
the agent's pre-push loop.

- `just mutate-diff` leaves the per-sprint cadence in `agent/autonomy.md`. It stays
  available, as an optimisation to avoid a round trip — never as an obligation.
- `mutation-ci.yaml` drops `continue-on-error` once per-crate baselines are
  ratcheted (`testing/ratchet.md`, unchanged: baseline, observe, ratchet).
- A **persistent compiler cache on the runner is part of the gate**, not a
  commented option.
- Tier 3 keeps `just code-review` local and per sprint. Review is minutes and can
  send a block back to the drawing board; only mutation moves.

Amendment 2026-09-13: the validation vocabulary now calls review **T3** and
mutation **T4**. This renames the depths; the PR cadence and calibration policy
above remain unchanged.

## Consequences

Survivors are found ~10 minutes after a push instead of in the editor: one round
trip each, accepted, because the alternative is the tax that gets a gate removed.

The gate now depends on runner state this repo does not own — a cold cache returns
it to a ~16-minute build. `CONTEXT.md` defines Tier 3 as "run before push"; that
definition changes. Triaging survivors becomes work attached to a PR, which has an
author, rather than to a calendar.

## Alternatives considered

- **Keep it local pre-push** — 19 minutes measured, ~9 once unviable mutants are
  excluded; defensible, but it spends cores the editor and the agent are using.
- **Defer to end of capability, with a budgeted correction task** — feedback five
  sprints from its cause, and a budget whose only legal exit is escalation anyway.
- **Nightly full sweep instead** — measures erosion of the whole tree, not this
  change; no owner, and no merge to block.

## Implemented

This record underestimated its own surface: the inverted doctrine was stated in
eight places, not the four named above — the cost of arguing every design choice
where it applies. The inventory is in the CHANGELOG, not here.

The Decision carries no language qualifier, so it was applied to TS and Python as
well. Their mutation cost was **never measured**; they inherit a cadence justified
on Rust numbers. If that turns out wrong for either, it is a new record.

Not load-bearing yet: all three `mutation-ci.yaml` snippets still ship
`continue-on-error: true`, so until a consuming repo ratchets its baseline this
gate reports and does not block. And nothing fails if the doctrine is reverted — it
is prose, and no test asserts it.
