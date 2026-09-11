<!-- `.work/autonomy/PLAN.md` — committed working memory for the autonomy chantier.
     Delete once wave 3 ships. Not a durable document. -->
# Plan: agent autonomy — cost, worktrees, orchestration

> Review of 2026-09-11. Supersedes the pasted draft plan, which was written before
> the mutation cost was measured and assumed the wrong bottleneck.

## Where we are

Tier 3 costs ~50 min on a sprint-sized Rust diff, so it drifted out of the loop and
the first instinct was to defer it to end-of-capability behind a budgeted correction
task. Measurement says otherwise: **22 minutes of that is the baseline, before the
first mutant runs**, and the per-mutant cost is compile-bound. Fixing the cost keeps
Tier 3 inside the loop and removes the need for deferral — along with its risk of
shipping unkilled survivors in silence.

The measured facts, on one real Rust repo:

| Measure | Value | Reading |
|---|---|---|
| `cargo mutants --list` (whole tree) | 8128 | exclusions unfilled; generated sources dominate |
| Mutants on a sprint-sized diff | 32 | `N` is small — exclusions are not the loop lever |
| Baseline build | 972 s | cold scratch-dir build; deps recompiled from zero |
| Baseline test | 363 s | paid again **in full by every surviving mutant** |
| Per mutant | ~60 s | incremental rebuild, not test execution |

The last row is the toxic one: cost spikes exactly when the gate has something to
say. A gate anti-correlated with its own usefulness is a gate on its way out —
`rules/testing/ratchet.md`, "one comment at a time".

## Durable decisions

Pointers, not copies. Two still need an ADR (wave 3).

- **Gates own correctness, humans own decisions** — unchanged (`rules/agent/decisions.md`).
- **Tier 3 stays in the loop, per sprint** — not per task, not per capability.
- **Parallelism is capability-level, never sprint-level** — a sprint is a vertical
  slice, so two sprints of one capability collide by construction.
- **One worktree per capability, one branch per sprint inside it** — the only
  arrangement coherent with `.work/<slug>/` being per-tree.
- **Mutualize builds with a content-addressed cache (sccache), never a shared
  mutable `CARGO_TARGET_DIR`** — the latter serializes on a lock, thrashes
  fingerprints across branches, and lets mutation artifacts land in the tree
  rust-analyzer reads.

## Waves

| # | Wave | Ships | Blocked by |
|---|------|-------|------------|
| 1 | Mutation cost | Tier 3 under 5 min on a sprint diff | — |
| 2 | Worktree + cadence doctrine | parallel work findable and reconcilable | — |
| 3 | Orchestration + fresh context | `just run-capability <slug>` | 1, 2 |

Waves 1 and 2 are independent and each useful alone. Wave 3 is the only one that
needs both, and the only one that needs an ADR.

---

## Wave 1 — Mutation cost

**Goal**: a sprint-sized Tier 3 run in 3–5 minutes instead of ~50. Validated on a
real Rust repo *before* any of it becomes doctrine.

- [ ] **1.1 `kit/rust/mutants.toml`** — ship generated-code exclusions by default,
      mirroring `review_exclude` in `kit/common/gate.just`. The concept already
      exists in one gate and is absent from the other. Keep both ADAPT lists; only
      the generated globs are pre-filled. *Protects the variance, not the average:
      the day a sprint regenerates an OpenAPI client, the same run goes from 32
      mutants to thousands.*
- [ ] **1.2 `kit/rust/rust.just`** — `rust-mutate` gains `-j`, `--profile mutants`,
      a restricted test scope, and `--baseline=skip` behind a variable (default
      off).
- [ ] **1.3 `kit/rust/cargo-profile.snippet.toml`** — `[profile.mutants]` with
      `debug = false`. Debuginfo generation is expensive and no one reads a mutant's.
- [ ] **1.4 `kit/rust/cargo-config.snippet.toml`** — `mold`/`lld` linker. Linking is
      30–50 % of a Rust incremental rebuild, which is the per-mutant term.
- [ ] **1.5 `kit/rust/README.md`** — sccache setup, and the `CARGO_TARGET_DIR`
      anti-pattern written down with its three failure modes.
- [ ] **1.6 Measurement protocol** — record before/after from
      `mutants.out/outcomes.json` (build vs test duration per phase), so the claim
      is a measurement and not a belief.

**Ranked by yield** — restrict test scope (hits the baseline *and* every survivor) >
`--in-place` in a dedicated worktree + `--baseline=skip` (removes the 1335 s) >
mold + `debug = false` (per-mutant rebuild) > `-j` > sccache (cold trees).

**Acceptance**: on the reference Rust repo, a sprint-sized diff completes Tier 3 in
under 5 minutes, and `outcomes.json` shows the build term collapsed.

**Two things to be honest about**:

- `--baseline=skip` is a **fail-open** if nothing guarantees a green tree first. It
  converts a self-check into an orchestrator invariant, which is acceptable only
  because the orchestrator just ran the gate. It stays off by default until wave 3.
- `--in-place` mutates the real working tree. Unacceptable in the main checkout,
  fine in a dedicated mutation worktree — which is what wave 2 builds.

---

## Wave 2 — Worktree placement and cadence

**Goal**: parallel trees that are findable without an archaeological dig, and that
reconcile instead of accumulating into a forest of detached branches.

- [ ] **2.1 `kit/common/gate.just`** — `worktree_root` (`${CR_WORKTREES:-$HOME/.worktrees}`),
      plus `just tree <slug>` (creates at the canonical path **and prints it**) and
      `just tree-rm <slug>` (removes worktree **and** branch in one act). A recipe,
      not prose: that is what stops an agent inventing a path.
- [ ] **2.2 `kit/common/worktree-status.mjs`** — print the absolute path for trees
      outside the current repo, so it is pasteable into an IDE rather than
      `../../.worktrees/...`.
- [ ] **2.3 `rules/agent/autonomy.md`** — four edits:
      split `mutate-diff` from `code-review` in the cadence table (1–3 min vs tens
      of minutes: not the same animal); define **coherent block = sprint**, which is
      where the per-task drift came from; state the worktree root rule; state
      capability-level parallelism.
- [ ] **2.4 `skills/tasks/SKILL.md`** — worktree is per **capability**, not per
      sprint (today it says `<repo>-<slug>-NN`, contradicting `autonomy.md`'s
      `<repo>-<slug>`); drop `or observation` from the acceptance-criteria line so
      every criterion carries a command.
- [ ] **2.5 `rules/testing/ratchet.md`** — two additions: the survivor cost spike
      (a survivor pays the full suite; a killed mutant exits on the first red test),
      and the crate-size ↔ mutation-cost link — **the hexagonal rule is also the
      mutation-performance rule**, which is an argument the repo does not yet make.

**Why the worktree root is outside the repo**: `<repo>/.worktrees/` is tempting and
is a trap in Rust — cargo workspace globs descend into it, `cargo mutants` copies
the tree to scratch and would copy every worktree with it, and rust-analyzer and
ripgrep index it. `.gitignore` does not stop tooling that does not read it.

**Reconciliation rules**: the tree's life is the work's life (destroyed in the same
act as the merge); rebase on trunk before each merge, not at end of capability;
`just status` already prints `(prunable)` and becomes the garbage collector — the
orchestrator refuses to start while a prunable or zero-commit tree remains.

**Acceptance**: `npm test` green; a jalon exercises the `tree` / `tree-rm`
round-trip; the worktree rule is stated in exactly one place.

---

## Wave 3 — Orchestration and fresh context per task

**Goal**: chain a capability's sprints automatically, each task implemented in a
context that cannot drift.

- [ ] **3.1 ADR-0002 `Proposed`** — autonomous sprint orchestration: what the
      orchestrator may decide alone, what suspends it, and the Cursor degradation
      (the orchestrator spawns a CLI; `gate.just` already parameterizes
      `reviewer := claude|codex|cursor` and the orchestrator should follow that
      shape rather than hardcode one). **A human accepts it; an agent cannot.**
- [ ] **3.2 `agents/task-implementer.md`** — ephemeral subagent receiving exactly
      the anchor, the neighbour file, the T0 contract and the done-command. It does
      not read the PRD or the intent discussion. *This is the real autonomy lever
      and it is independent of everything about cost*: `loop-setup`'s prompt already
      says "do not trust your memory of prior turns" and nothing enforces it.
- [ ] **3.3 `skills/loop-setup/SKILL.md`** — the loop prompt spawns a fresh
      subagent per task instead of accumulating one context across the sprint.
- [ ] **3.4 `skills/tasks/SKILL.md`** — `--headless`: skip the granularity quiz
      when the invariants of step 1 and step 4 hold. It is the only human stop on an
      otherwise deterministic path.
- [ ] **3.5 `kit/orchestrator/`** — new kit dir **and its own profile**, opt-in like
      `devstack`. `kit/common` ships with every profile; a repo that installed `ts`
      for eslint must not inherit a sprint orchestrator. Contains `orchestrator.mjs`
      (`just run-capability <slug>`) and `spec-check.mjs` (cycles, acceptance
      commands actually exist in the repo).
- [ ] **3.6 `kit/common/adr-check.mjs`** — add `--require-accepted`. Extend the
      single owner of ADR-status truth; do not open a second reader of `docs/adr/`.
- [ ] **3.7 Wiring — the part that makes it "done"** — `registry.json` entry,
      README catalogue (`test/registry.test.mjs` fails if it disagrees),
      `/architect` gating table, `test/skills.test.mjs`, a jalon for the
      orchestrator, CHANGELOG.

**The chaining gate**, since Tier 3 stays in the loop: `just check` green **+**
every acceptance-criterion command green **+** `review-guard` CLEAN. Sprints chain
sequentially inside a capability; capabilities run in parallel trees.

**Two invariants the orchestrator must carry**:

1. A capability never reaches `SHIPPED` with outstanding survivors or a standing
   `CRITICAL`.
2. Budget exhaustion has exactly one legal exit — `BUDGET_EXHAUSTED` +
   `## Blocked on the human`. Never "ship anyway". Excluding a killable mutant or
   lowering a baseline are hard bypasses (`rules/agent/autonomy.md`).

**Escalation reuses what exists**: `## Blocked on the human` in the worklist
(aggregated by `just status`) and `just publish-summary`, which already has the
three statuses. No new verdict file.

---

## Cut from the original draft, and why

| Item | Reason |
|---|---|
| `plan.dag.json` | `PLAN.md`'s `Blocked by` column *is* the DAG. Two homes for one fact, and the JSON is the copy that goes stale. Parse the table instead. |
| `task-verdict.json` | A third escalation channel next to `## Blocked on the human` and `SUMMARY.md`. One more place an agent can write "blocked" unseen. |
| Tier 3 deferred to end of capability | Batching does not reduce cost (mutants scale with the diff) — it moves latency. Fixing the cost is cheaper and keeps feedback close. |
| Correction task with a budget | Disappears with the deferral. A survivor found five sprints late often signals an untestable seam — a design problem a budgeted task cannot fix, only paper over. |
| Assertion command in `/plan` | `/plan` forbids implementation detail and freezes a sprint at `Shipped`. The slot already exists one level down in the `/tasks` worklist. |
| ADR governance edits to `decisions.md` | Already the rule, already enforced by `adr-check.mjs`. What is new is orchestrator behaviour, which belongs where the loop lives. |
| `orchestrator.mjs` in `kit/common` | `common` ships to every profile. Coupling, not size — `.memory/OVERENGINEERING.md` charge #5. |

## Open decisions

These block specific items, not the whole plan.

- **Is mutation scoped to unit tests only?** Doctrinal, not technical — it is the
  highest-yield lever in wave 1 and it changes what the mutation score means.
  Blocks 1.2.
- **Accept the `--baseline=skip` invariant?** Converts a fail-closed self-check into
  an orchestrator guarantee. Blocks turning it on by default.
- **Does `/tasks --headless` ship?** Blocks 3.4 only.
- **Cursor degradation for the orchestrator** — parameterized like `reviewer`, or
  declared Claude-only? Blocks 3.1.
