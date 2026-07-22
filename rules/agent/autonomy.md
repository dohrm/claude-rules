---
title: "Agent Autonomy"
---

An agent that writes or changes code closes its OWN loop against the gates — the
human is not the feedback loop. This is what lets review move from line-by-line
to the boundary: the machine enforces correctness, the human judges design.

## The self-closing loop

1. Write the code AND its tests.
2. Run the repo's check command — all local gates at once: **`just check`**
   (fmt, lint `-D warnings`, tests, deny…). If the repo has no justfile, run the
   tiers directly: `lefthook run pre-commit --all-files && lefthook run pre-push --all-files`.
3. Read the failure, fix the ROOT CAUSE, re-run. Iterate until green.
4. Only then hand back. "Done" means **you re-ran the gate and it exited green** —
   never your own say-so that it "should pass", never "I wrote it". Validation
   passing is the gate; your belief is not. Do not trust a prior run's claim —
   re-run and read the exit code.

## Authority

The deterministic gate is the authority on correctness — not the human's word,
not the agent's prose. An agent/review opinion is a *proposal*; a green gate is
*permission*.

## Two-speed loop

- **Local (Tier 1-2** — fmt, lint, tests, deny): the agent self-serves, seconds.
- **CI (Tier 3** — mutation testing, `--in-diff`): asynchronous, at PR. It checks
  that the tests actually *assert*, not merely execute. When it reports surviving
  mutants, the agent strengthens the tests — same self-closing loop, slower cadence.

## Never fake green (two tiers)

A gate you bypass is a gate you no longer have.

- **Hard — never bypass; escalate instead.** Correctness, security, `secret-scan`,
  and behavioral tests. No `--no-verify`, no disabling a gate, no `#[ignore]` /
  `.skip`, no weakening an assertion to make it pass. If the agent cannot satisfy
  one of these by fixing the cause, it **STOPS and asks the human**. The green
  must always be true.
- **Soft — traced bypass allowed.** Minor style/lint only, and ONLY with a
  justification comment on the same line — as `//nolint` requires in
  `go/quality-gates`. No bare `#[allow(...)]` / `// eslint-disable` without a
  stated reason.

**Declare every bypass.** Even a permitted (soft) one. No silent TODO, skipped
test, placeholder, or stubbed mock slipped into a hand-back — if you defer or
stub anything, say so out loud. A hidden gap is worse than a flagged one.

Escalate loudly; never silently pass.
