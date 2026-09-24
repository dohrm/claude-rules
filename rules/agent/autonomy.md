---
title: "Agent Autonomy"
---

An agent that writes code closes its OWN loop against the gates. The machine
enforces correctness; the human judges design.

## The loop

1. Write the code AND its tests.
2. Run **`just check`**. No justfile → `lefthook run pre-commit --all-files && lefthook run pre-push --all-files`.
3. Read the failure, fix the ROOT CAUSE, re-run until green.
4. Once the block stands alone — **before pushing** — run `just code-review` and
   fix `CRITICAL`, then loop to 2. **Mutation is not in this loop**: it is a gate on
   the pull request. Run `just mutate-diff` yourself only to avoid a
   round trip on code you have reason to doubt — it is an optimisation, never a step
   you owe.
5. Hand back only after a **fresh green run**. Belief is not permission. Do not
   trust a prior run's claim — re-run and read the exit code.

Cadence — none of these is "wait for the human" or "wait for the PR":

| When | Command | What it answers |
|---|---|---|
| Per iteration | `just check` (Tier 1-2) | fmt, lint, tests, deny — seconds |
| Per sprint, before push | `just code-review` (Tier 3) | judgment a gate cannot make — minutes |
| Per push | CI | a **witness**, same tools on the PR diff |
| Per pull request | `mutate-diff` in CI (Tier 4) | do the tests *assert*? — **the gate**, not a witness |

**The coherent block is the sprint**, not the task. Say it plainly because the
drift is one-way: a loop that commits per task starts running Tier 3 per task, and
then Tier 3 is a tax somebody eventually removes.

Tier 3 is code review; Tier 4 is mutation (or the weaker Go coverage ratchet).
Review is minutes and its feedback can redesign a block, so it stays close. Mutation
was measured at tens of minutes, and its remaining lever is `-j` — cores a laptop
cannot spend while the editor and the agent are using them. It moved to the PR,
where it **blocks the merge once calibrated and ratcheted**. Shipped snippets
start non-blocking to measure the baseline; declare that state rather than claiming
enforcement. One round trip per survivor is accepted as the price.

`just code-review` writes `.work/review-report.md`. `just review-guard` (pre-push,
no LLM) reads it. Marker rules: `.dev/kit/common/review-guard.mjs`.

**Detect, never assume.** Tier 3 is sometimes absent (`just --list`):

- recipe present → running it is part of "done";
- recipe absent → say so in the hand-back. Never silently skip, never assume green.
  No report → `review-guard` passes and tells you to declare it.

## Authority

A green gate is permission for **code**. An agent or review opinion is a proposal.
A green gate never settles a **decision** — that line is `agent/decisions.md`.

## Levels

How often the agent stops to ask is a per-run choice, declared once in the state
file header — `.work/<slug>/PLAN.md`, the worklist, or `loop.md`:
`**Autonomy**: L1 | L2 | L3`.
The human picks it at launch, from the model *and* the risk of the work; a level
names a delegation, never a model. **Absent or unreadable → L1.**
A level passed at launch is written into that header before the first turn: the
state file is the source of truth, so a level that lives only in the prompt is lost
at the next one. A skill that runs another passes its resolved level as the argument
(`/tasks L3`) — the callee's own lookup would fall back to an older header or to L1.

| Level | The human validates | The agent settles alone |
|---|---|---|
| **L1 — guided** | every checkpoint a skill marks, before the next step | nothing a skill marks as a checkpoint |
| **L2 — delegated** | each skill's written output, once | the open questions the code answers, each one recorded |
| **L3 — autonomous** | only the hard checkpoints below | the cut, the loop's caps, chaining `/plan` → `/tasks` → `/loop-setup` → launching the loop, sub-agents |

**Hard checkpoints — identical at every level:** an ADR status (`agent/decisions.md`);
a new acceptance criterion, User Story or scope change; a sprint's `Shipped` and its
merge; a hard bypass (below); a tree that contradicts the state file.

A level moves *when* the human is asked, never *what* counts as done. The gate, the
caps, the divergence guard, the escalation channel and one-tree-one-writer hold at
L3 exactly as at L1 — at L3 the agent sets the caps' values itself, but writes them
in the state file before the first turn, where the human can read or lower them. Under L2+, every question settled without asking is written
where the human will read it — the document's `## Assumptions`, else `## Log`. An
unrecorded assumption is a silent scope change.

**Only the human raises a level.** An agent may always drop one: an L3 run facing an
ambiguity the code cannot settle asks, which is escalation, not failure.

## One tree, one writer

`.work/` (review report, worklist) is per-tree. Two sessions in one checkout
share one verdict: A's `CLEAN` authorises B's push. **One tree, one writer, one
branch, one worklist.**

Parallel work gets a parallel tree, at a path you do not have to remember:

```bash
just tree <capability-slug>     # prints the path; one tree per capability
just tree-rm <capability-slug>  # tree AND branch, at the merge, in one act
```

Every tree on the machine lives under one root (`$CR_WORKTREES`, default
`~/.worktrees/<repo>/<slug>`) — outside every repo, because a checkout nested in a
repo is one every tool scans. **One tree per capability, one branch per sprint
inside it**: `.work/<capability-slug>/` is per-tree and holds that capability's plan
and all its worklists, so any other split puts one work unit in two trees.

**Parallelise across capabilities, never across the sprints of one.** A sprint is a
vertical slice, so two sprints of the same capability traverse the same layers and
collide by construction — `Blocked by` in the plan serialises the dependent ones,
and the rest are independent as promises, not as files.

The tree dies with the work. `tree-rm` removes nothing unless the tree is clean and
the branch is merged, so a forest of detached branches is something you have to
build on purpose. `just status` reports every tree; it never gates.

The human is a writer too. When they edit the tree a loop owns — legitimate, and
declared as a `human:` line in `## Log` (`skills/loop-setup`) — that line is a
**fact about the tree**, not an item to redo or undo. So: re-read the code you are
about to touch, every turn; your memory of the previous turn is not the tree. And
**never revert a change you cannot explain** — a tree that contradicts the
worklist is an escalation, not a merge conflict to resolve on your own.

## Never fake green

- **Hard — never bypass; escalate.** Correctness, security, `secret-scan`,
  behavioral tests. No `--no-verify`, no disabling a gate, no `#[ignore]` /
  `.skip`, no weakening an assertion. Same for excluding a mutant you could
  kill, lowering a ratchet baseline, or hand-editing `.work/review-report.md`.
  Cannot fix the cause → **STOP and ask**. The green must be true.
- **Soft — traced bypass allowed.** Minor style/lint only, with a justification
  comment on the same line. No bare `#[allow]` / `eslint-disable` / `# noqa` /
  `# type: ignore`.

The git floor (`lefthook`) and the harness layer (`kit/common/hooks/`, opt-in)
make bypass expensive and loud, not impossible. Wiring:
`.dev/kit/common/hooks/README.md`. This rule is still the rule.

**Declare every bypass.** No silent TODO, skipped test, placeholder, or stub.

**Escalate in that tree's `.work/<slug>/tasks/NN-*.md` → `## Blocked on the human`** —
what `just status` surfaces. Never in the review report.
