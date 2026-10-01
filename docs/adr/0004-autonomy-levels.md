# ADR-0004: Declare agent autonomy as a per-run level, defaulting to guided

- **Status**: Proposed
- **Date**: 2026-09-23

## Context

`/plan`, `/tasks` and `/loop-setup` stop for human validation at every phase and
size the worklist for a cold, weak implementer. That framing fits open-weight
models. Frontier models, like Opus 5.5, resolve most of those questions from the
code and can run a whole sprint per turn. For them, the checkpoints cost the human
attention without catching anything. The maintainer runs both kinds of model on the
same repositories, so a single fixed framing is wrong for one of them. The
invariants that make agent output trustworthy (the gate, ADR ceremony, `Shipped`
as a human act) are about authority, not capability, and must not vary.

## Decision

We will declare autonomy as a level chosen per run, not per model or per repo.

- Three levels: L1 guided, L2 delegated, L3 autonomous. They are defined once in
  `rules/agent/autonomy.md` § Levels, and the skills point there.
- The level is declared as `**Autonomy**` in the state file header. **Absent means L1**,
  and L1 is today's behavior, unchanged.
- A level changes when the human is asked, the depth of the worklist, and how much
  one loop turn covers. At L3 the agent also sets the loop's cap values itself,
  writes them in the state file, and launches the loop. It never changes whether
  caps exist, the gate, the escalation channel or the hard checkpoints (ADR status,
  new scope, `Shipped`, hard bypass).
- Under L2+, every question settled without asking is recorded as an assumption.
- Only the human raises a level. An agent may always drop one.
- One authored skill per procedure, with marked level branches. No per-level
  variants in the registry.

## Consequences

The skills grow by about 15% and carry conditional steps. For a small model, those
are exactly where it can slip. L1 correctness now depends on the default being
honored. An L3 run makes more unasked choices, including its own budget, visible
only if the human reads `## Assumptions` and the state file's guardrails. Whether L1
would do better as a compact checklist than as argued prose is unmeasured. The eval harness needs one case per level to find out.

## Alternatives considered

- Per-model variants in the registry: two copies drift, and model names age within months.
- A repo-wide level in `CLAUDE.md`/`AGENTS.md`: wrong granularity, because one repo is run by several models.
- Relax the invariants at L3 too: a stronger model does not make a fake green less harmful.
- Keep one strict framing: taxes frontier runs with checkpoints that catch nothing.
- Stop L3 at the launch command: keeps the human in the loop for one keystroke that catches nothing the caps do not.
