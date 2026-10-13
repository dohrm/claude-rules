# ADR-0009: Add an L4 level that delegates named checkpoints inside a verified domain

- **Status**: Accepted
- **Date**: 2026-10-12

## Context

At L3 an agent runs every RFC phase alone, so the human's remaining load is the hard
checkpoints. ADR-0004 makes those identical at every level. On a long RFC, the human
is paged at every phase merge and machine-checkable hold, which the gates already
prove. Delegation poker (Management 3.0) delegates per decision area, not globally.
SAE J3016 bounds driving automation by an operational design domain (ODD). Outside
that domain, the vehicle reaches a minimal-risk condition on its own. A manager that
validates work in a context it did not write weakens the self-preference bias, but
only a different model removes the blind spots that come with shared weights.

## Decision

We will add **L4 — orchestrated**: L3 plus the checkpoints the RFC explicitly delegates.

- The RFC carries a **delegation board**: the delegated checkpoints, the allowed
  executors (coding agent + model, chosen by the human) and the caps. Without a
  board, L4 runs as L3.
- **Delegable**: a phase merge into the RFC branch, a machine-checkable hold, and a
  `changed:` local decision. **Never delegable**: an ADR status, scope or acceptance
  criteria, a hard bypass, a production hold, the merge into the base branch, `Shipped`.
- **Branches**: phases branch from `rfc/<slug>`. The orchestrator merges phase PRs on
  hard proof (gates, Tier 3, Tier 4 in CI). The human merges `rfc/<slug>`.
- **ODD checked at launch**: the stopping condition fails for the right reason, every
  delegated hold has a command, the executors are detected. If any check fails, the
  run drops to L3. Outside the ODD, the run parks the branch, escalates and stops.
- **Cascade**: the orchestrator may run detached executors, and it decides which
  phases run in parallel. It delegates only what it received, and an executor never
  runs at L4. It launches only executors the board lists. The machine's inventory
  of installed executors is configuration, not part of this decision. Reviewers are
  unrestricted.
- A final report lists every delegated decision with its proof and reversibility.

## Consequences

CI must run on PRs targeting `rfc/**`, or delegated merges lack Tier 4. A production
hold splits the RFC into human merge points. The final PR exceeds `review_max_bytes`,
so the human review is high-level by design. Parallel phases need one tree per phase,
with the RFC state written only in the integration tree. On a single-vendor setup,
the executor and the orchestrator share blind spots, and only hard proof covers them.
Each RFC needs an executor list, which a per-machine default can seed.

## Alternatives considered

- Relax hard checkpoints at L3: removes them without the board that bounds the delegation.
- Orchestrator merges into the base branch: makes an unreviewed change shippable, with no cheap rollback.
- Model tiers capping the executor: a coding agent changes a model's results, so ranking pairs is subjective and ages with every release.
- Orchestrator picks executors freely: the manager may no longer judge the work, and cost is unbounded.
