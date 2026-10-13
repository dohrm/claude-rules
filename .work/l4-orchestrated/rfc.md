# RFC — Implement L4 (orchestrated): delegation board, verified ODD, executors, RFC integration branch

- **Status**: implementing
- **Autonomy**: L3
- **Repository**: git@github.com:dohrm/claude-rules.git
- **Base branch**: next
- **Branch**: rfc/l4-orchestrated
- **Stopping condition**: `npm test` green, and `node kit/common/adr-check.mjs` reports
  nothing on ADR-0004/0009 (0008's pre-existing ceiling failure excepted)
- **Serves**: —
- **Constrained by**: ADR-0009 § Decision (the whole level), ADR-0004 § Decision (levels
  per run, absent → L1, only the human raises a level), ADR-0007 § Decision (one RFC,
  phases are PRs), ADR-0003 (Claude and Codex emitters; no claim of native Codex features)

## Request

j'ai accépté l'adr.
on peux commancer l'implémentation

(ADR-0009, accepted in 92c5c58.)

## Goal

A human can launch `/rfc implement` at L4 on an RFC that carries a delegation board.
The orchestrator then runs every phase through executors it may detach, and merges
each phase into the RFC's integration branch on hard proof. It stops only on what the
board does not delegate. The human receives one final PR with a report and merges it.

## Scope

- In: `rules/agent/autonomy.md`, `skills/rfc/` (SKILL, local, ticket), `skills/loop-setup`
  (L4 behaves as L3), `CONTEXT.md`, kit CI templates and this repo's CI (PRs to `rfc/**`),
  `kit/common/work-slug.mjs` (phase branches find their RFC), a dated note on ADR-0004,
  README and CHANGELOG.
- Out: a per-machine executor inventory and its default (later, if lists get tedious);
  automatic `base` derivation for gates on a phase branch; an eval case for L4 (manual,
  spends tokens); any change to Codex emission.

## Local decisions

- **Branch names**: integration `rfc/<slug>`, phases `phase/<slug>/<n>`. Git refuses
  `rfc/<slug>/phase-n` next to `rfc/<slug>` (a ref cannot be both file and directory).
- **Board shape**: a `## Delegation board` section in the RFC, with three lists:
  delegated checkpoints (taken only from ADR-0009's delegable set), executors as
  `<coding agent> · <model>`, and caps (per-executor token or wall-time budget, rejected
  rounds per phase before the orchestrator stops). A missing section or a missing list
  means L3.
- **ODD record**: the launch check writes one `ODD:` line per prerequisite in `## Log`.
  A change whose stopping condition cannot fail first (pure prose) cannot run at L4.
  A failed check writes `dropped to L3: <why>` and rewrites `**Autonomy**` to L3.
- **State ownership**: only the orchestrator writes `rfc.md`, in the integration tree.
  An executor never edits it. Its report is the phase PR's description.
- **Phase gates**: an executor runs `just base=origin/rfc/<slug> code-review`, so the
  review diffs the phase, not the whole RFC.
- **Slug resolution**: `work-slug.mjs` gains a step between 2 and 3: a branch
  `phase/<slug>/<n>` with `.work/<slug>/rfc.md` present resolves to `<slug>`.
- **Final report**: the description of the `rfc/<slug>` → base PR. It lists every
  delegated decision with proof and reversibility, assumptions, `changed:` lines, holds
  checked with their output, and divergences from the plan. The RFC file is deleted at
  merge, so the PR is the durable home.
- **Minimal-risk condition**: commit nothing half-done to `rfc/<slug>`, leave phase
  branches as they are, write `## Blocked on the human`, stop.
- **Loops**: `/loop-setup` reads L4 as L3; a loop has no delegable checkpoint.
- **ADR-0004**: a dated amendment of five lines or fewer, pointing to ADR-0009 for the
  delegable checkpoints. Its status line is not touched.

## Steps

- [x] Doctrine — `rules/agent/autonomy.md` § Levels: L4 row, the delegable/never split,
  board, ODD, cascade, minimal-risk condition; § One tree, one writer: at L4 one tree
  per phase, the integration tree as the only RFC writer, parallel phases allowed on a
  declared dependency graph; the hard-checkpoints paragraph says "except what an L4
  board delegates" → proof: `npm test`
- [x] Glossary — `CONTEXT.md`: Delegation board, ODD, Orchestrator, Executor,
  Integration branch → proof: `npm test`
- [x] Skill — `skills/rfc/SKILL.md`: header `L1 | L2 | L3 | L4`, `## Delegation board`
  in `<rfc-body>`, § 4 L4 branch (launch check, integration branch, executor briefs = the
  RFC + phase number + level, phase merge on proof, parallelism, final report);
  `local.md` / `ticket.md`: where the report and ODD lines go → proof: `npm test`
- [x] Loop — `skills/loop-setup/SKILL.md`: L4 runs as L3 → proof: `npm test`
- [x] Slug — `kit/common/work-slug.mjs` new step + a case in `test/gates.test.mjs`
  that fails without it → proof: `node --test test/gates.test.mjs`
- [x] CI — `pull_request.branches` gains `'rfc/**'` in `kit/{rust,python,ts}/mutation-ci.yaml`,
  `kit/go/coverage-ci.yaml`, `kit/cicd/ci.snippet.yaml`, `.github/workflows/ci.yml`
  → proof: `npm test`
- [x] Records — ADR-0004 amendment, README row on `/rfc`, CHANGELOG `[Unreleased]` → proof:
  `node kit/common/adr-check.mjs`, `npm test`

## Open questions

- none

## Assumptions

- Verdict: one RFC, one PR, no phases. One change with one end, and the diff is prose plus
  one small script change.

## Blocked on the human

## Revisions

- round 1: autonomy L3 (human); branch names `rfc/<slug>` + `phase/<slug>/<n>` confirmed;
  a pure-docs RFC cannot run at L4 (its stopping condition cannot fail first) and drops to L3

## Log

- doctrine: `autonomy.md` § L4 + one-tree exception; `gate.just` tree comment — `npm test` green.
  `changed: ADR citation — shipped rules may not cite this repo's ADRs (asset test); § L4 names none`
- glossary: Delegation board, ODD, Orchestrator / Executor in `CONTEXT.md`.
  `changed: Integration branch — folded into Orchestrator / Executor, one entry fewer`
- skill: `/rfc` L4 branch (6 steps), board in `<rfc-body>`, record homes in local/ticket.
- loop: `/loop-setup` writes L3 for L4.
- slug: `phase/<slug>/<n>` → `<slug>`; new test red before the fix (assertion), green after.
- CI: `'rfc/**'` on the four kit workflows, the CI snippet and this repo's CI.
- records: ADR-0004 dated amendment (status untouched), README, CHANGELOG (hand merge noted).
- stopping condition: `npm test` 399 pass / 0 fail / 7 skipped (toolchain jalons);
  `adr-check --strict` silent on 0004/0009. Tier 3: no `just code-review` in this repo
  (no justfile) — not run, declared.
- review (independent sub-agent, separate context, as Tier 3 stand-in): 6 findings, all
  fixed — executor clause (never edits `rfc.md`, never merges), pull `rfc/<slug>` before
  cutting a phase, push `rfc/<slug>` and RFC commits, ODD requires `rfc.md` committed on
  `rfc/<slug>`, `kit/common/README.md` slug order, unreachable `done` at L4 reworded.
  `npm test` 399 pass / 0 fail after fixes.
