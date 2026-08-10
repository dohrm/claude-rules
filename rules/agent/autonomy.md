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
4. Once the block of work stands on its own — and before pushing — run the
   Tier 3 gate if the repo has one (`just mutate-diff`). Kill the survivors that
   deserve it, then loop back to 2.
5. Only then hand back. "Done" means **you re-ran the gate and it exited green** —
   never your own say-so that it "should pass", never "I wrote it". Validation
   passing is the gate; your belief is not. Do not trust a prior run's claim —
   re-run and read the exit code.

## Authority

The deterministic gate is the authority on correctness — not the human's word,
not the agent's prose. An agent/review opinion is a *proposal*; a green gate is
*permission*.

## Three-speed loop

The loop above runs at three cadences. Each one is self-served — none of them is
"wait for the human" or "wait for the PR".

1. **Per iteration — `just check`** (Tier 1-2: fmt, lint, tests, deny). Seconds.
2. **Per coherent block — `just mutate-diff`** (Tier 3: mutation on the changes
   since the merge-base). Minutes, so not once per edit — once per block of work
   that stands on its own, **before pushing**. It answers the one question the
   fast loop cannot: do the tests *assert*, or do they merely execute? Surviving
   mutants come back while the code is still in your head. Triage them per
   `testing/ratchet.md` — the survivor may mean a missing test, an equivalent
   mutant, or dead code.
3. **Per push — CI.** A witness, not the loop. It re-runs the same tools on the
   PR diff so the verdict is reproducible by someone other than you. **Waiting
   for CI to learn something you could have learned locally is a broken loop**,
   not a slow one.

**Detect, never assume.** Tier 3 tooling is per-repo and sometimes absent (Go has
no production-grade mutation tool). Check what the repo actually exposes —
`just --list` — and:

- recipe present → running it is part of "done";
- recipe absent → say so in the hand-back ("mutation not run: no `mutate-diff`
  recipe in this repo"). An unrunnable step is reported, never silently skipped
  and never assumed green.

## Never fake green (two tiers)

A gate you bypass is a gate you no longer have.

- **Hard — never bypass; escalate instead.** Correctness, security, `secret-scan`,
  and behavioral tests. No `--no-verify`, no disabling a gate, no `#[ignore]` /
  `.skip`, no weakening an assertion to make it pass. Tier 3 has its own two
  versions of this move: **excluding a mutant you could have killed**, and
  **lowering a ratchet baseline** to turn a run green. Both are the hard kind.
  If the agent cannot satisfy
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
