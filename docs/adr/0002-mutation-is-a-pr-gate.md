# ADR-0002: Mutation testing is a PR gate, not a pre-push step

- **Status**: Proposed
- **Date**: 2026-09-11

## Context

`rules/agent/autonomy.md` puts `just mutate-diff` in the agent's per-block loop,
and `kit/rust/mutation-ci.yaml` calls its CI job "the WITNESS, not the first
observation". Measured on one Rust workspace, that loop step cost ~50 minutes for
a 32-mutant diff — **22 of them the baseline alone** (972 s build, 363 s test),
because cargo-mutants builds a cold scratch copy. Mutation there is compile-bound,
not test-bound.

After sccache, a faster linker, `debug = "none"` and `-j 2`, the baseline build
fell to 113 s and a 65-mutant diff still ran ~30 minutes. The drop is real; the
suite time also fell (363 s → 95 s) for reasons the changes do not explain — the
codebase moved between the two runs, so only the build figure is attributable.

The remaining lever is `-j`, and it is the one a laptop cannot spend: raising it
contends with the editor, rust-analyzer, and the build the agent is about to run.

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

## Consequences

Survivors are found ~10 minutes after a push instead of in the editor: one round
trip each, accepted, because the alternative is the tax that gets a gate removed.

The gate now depends on runner state this repo does not own — a cold cache returns
it to a ~16-minute build. `CONTEXT.md` defines Tier 3 as "run before push"; that
definition changes. Triaging survivors becomes work attached to a PR, which has an
author, rather than to a calendar.

## Alternatives considered

- **Keep it local pre-push** — still ~30 minutes per sprint diff after every lever;
  the cost spikes when the gate finds something, which is how gates die.
- **Defer to end of capability, with a budgeted correction task** — feedback five
  sprints from its cause, and a budget whose only legal exit is escalation anyway.
- **Nightly full sweep instead** — measures erosion of the whole tree, not this
  change; no owner, and no merge to block.
