---
title: "Agent Autonomy"
---

An agent that writes code closes its OWN loop against the gates. The machine
enforces correctness; the human judges design.

## The loop

1. Write the code AND its tests.
2. Run **`just check`**. No justfile → `lefthook run pre-commit --all-files && lefthook run pre-push --all-files`.
3. Read the failure, fix the ROOT CAUSE, re-run until green.
4. Once the block stands alone — **before pushing** — run the Tier 3 recipes the
   repo has: `just mutate-diff`, then `just code-review`. Kill survivors that
   deserve it (`testing/ratchet.md`), fix `CRITICAL`, loop to 2.
5. Hand back only after a **fresh green run**. Belief is not permission. Do not
   trust a prior run's claim — re-run and read the exit code.

Cadence — none of these is "wait for the human" or "wait for the PR":

| When | Command | What it answers |
|---|---|---|
| Per iteration | `just check` (Tier 1-2) | fmt, lint, tests, deny — seconds |
| Per coherent block, before push | `just mutate-diff` then `just code-review` | do the tests *assert*? judgment a gate cannot make |
| Per push | CI | a **witness**, same tools on the PR diff |

`just code-review` writes `.work/review-report.md`. **`just review-guard`**
(pre-push, no LLM) reads the two markers at its end: a `CRITICAL` blocks
**whatever sha it was written against** — committing on top does not expire it.
A stale `CLEAN`/`WARNINGS` passes with a notice.

**Detect, never assume.** Tier 3 is sometimes absent (`just --list`):

- recipe present → running it is part of "done";
- recipe absent → say so in the hand-back. Never silently skip, never assume green.
  No report → `review-guard` passes and tells you to declare it.

## Authority

A green gate is permission for **code**. An agent or review opinion is a proposal.
A green gate never settles a **decision** — that line is `agent/decisions.md`.

## One tree, one writer

`.work/` (review report, phase file) is per-tree. Two sessions in one checkout
share one verdict: A's `CLEAN` authorises B's push. **One tree, one writer, one
branch, one phase file.** Parallel work gets a parallel tree:
`git worktree add ../<repo>-<slug> -b <branch>`. `just status` reports every
tree; it never gates.

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
make bypass expensive and loud, not impossible. This rule is still the rule.

**Declare every bypass.** No silent TODO, skipped test, placeholder, or stub.

**Escalate in that tree's `.work/phase-NN-*.md` → `## Blocked on the human`** —
what `just status` surfaces. Never in the review report.
