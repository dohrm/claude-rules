# Inventory against docs/DIRECTION.md — 2026-11-23

Working document: the chantiers that come out of the inventory, the human's
arbitrations, and the issue triage. Each chantier becomes an RFC (or an issue) of its own.

## Arbitrations (human, 2026-11-23)

- Approvals go through the escalation queue, kind `approval`.
- `secret-scan` is wired with gitleaks (today `rules/agent/autonomy.md:215` names a
  gate that does not exist in `kit/`).
- Event-triggered runs are out of scope.
- No stack is retired (Rust, Go, TS front/back, Tauri, Python, gRPC, Godot C#).
- Retire: `profile`, `diagram`, `ui-prompt`, `pre-mortem`, `agents/code-simplifier`.
  Merge `migrate` into `update`, `agents/code-reviewer` into `kit/common/review-prompt.md`.
  Freeze and archive `eval/adr-bench` results.
- Cursor retirement and Pi stay horizon (temper's lock still lists `cursor`).

## Chantiers, in order

| # | Chantier | What | Cost | Issues |
|---|---|---|---|---|
| 0 | Quick wins | gitleaks as `secret-scan`; re-scope `paths:` of `testing/ratchet`, `ops/delivery`, `ops/observability`, `ops/slo` (~2.8k words off every source read); retirements above | S | — |
| A | Escalation interface | fixed block (project, RFC/phase, class `budget/scope/product/approval`, 3 lines, one question, options + recommendation, reversibility, default); class rules for every stop in `rfc` and `defect`; local stops (detached HEAD, store absent) become `changed:`/Assumptions; answers survive `.work/` deletion (final PR `## Escalations` table); `worktree-status` emits JSON; `escalation-check` validates the shape | M | new |
| B | L4 authority by mechanism | extract the referee from PR #107 with its review fixes (exact justify match, infra failures do not burn rounds, `l4_ci` default, board read from the committed RFC); `rfc-check` on the state file; required CI check on `rfc/*` | M | #102, #90, #94 |
| C | Context diet | autonomy § L4 (893 words) and the L4 orchestrator part of `skills/rfc` (~800) out of the always-loaded set, loaded by the orchestrator only; trim `decisions.md` sections only `/architect` and `/solution-exploration` need; quality-gates tables → pointer to the `.just`; `gate.just` comment history → README. After A and B: same files | M | — |
| D | Prose → checks (ratchet) | `bypass-check` (bare suppressions, skip/ignore on added lines), `rust-layout` (test-layout, hexagonal deps, function length), `todo-check`, defect recipe (repro red on base, no `[DEBUG-`), `ready`-author guard, linters for hexagonal (depguard/import-linter) and k8s (kube-linter) | S each | #58 |
| F | Mutation (Tier 4) | decide first: ADR-0002 says PR gate, six audited repos say it blocks nothing | decision | #56, #52, #94, #95, #68 |

## Other issues

| Issue | Verdict |
|---|---|
| #111 gitattributes | finish (in progress, lightens PR review) |
| #89 tag is the version | keep, S — the rule follows the consumers |
| #59 harness does not scale down | keep, high — the benchmark user's case |
| #100 headless `/update` across repos | raised: locks show stale profiles (`loop-setup`, `incident`) and unpinned `ref: main` in team repos |
| #81 `/adr-review` on `next` | close or rebase — ran on 2026-11-04 |

WIP rule until #111 is done and #102/#81 are settled: open nothing new.

## Evidence notes

- Usage comes from the consumers' `.claude-rules.lock`, not from the brain (which names
  projects, never stacks).
- The skills, rules and kit reports were produced by three read-only sub-agents; the
  `secret-scan` absence and the stack usage were re-verified by hand.
