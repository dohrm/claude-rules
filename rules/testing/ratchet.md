---
paths:
  - "**/*.rs"
  - "**/*.go"
  - "**/*.ts"
  - "**/*.tsx"
title: "Testing — Coverage, Mutation & the Ratchet"
---

Most of this code is written by an agent, and an agent can produce a suite that
executes every line while asserting nothing. Coverage cannot see that. **Mutation
score can**: it changes the code and asks whether any test notices.

## Coverage is a symptom, never a target

- Coverage answers "was this line executed?", not "would a bug here fail the
  build?". A test with no assertion scores the same as a real one.
- **Never set a coverage percentage as a goal.** Made a target, it is met by
  writing assertion-free tests over trivial code — the metric goes up and the suite
  gets worse (Goodhart, applied to CI).
- Use it the one way it is honest: as a **map of what is untested**. Uncovered
  error paths and uncovered branches in domain code are the report worth reading.

## Mutation score is the gate that means something

A mutant is a small change to production code — a flipped comparison, a dropped
statement, a swapped return. If the suite still passes, that mutant **survived**,
and the behavior it changed is unprotected. This is the check that lets
agent-written tests be trusted without reading every assertion by hand.

- **Scope it to changed code** (`--in-diff` and equivalents). Whole-repo mutation
  runs take hours; a diff-scoped run takes minutes.
- **Never a git hook.** Anything that re-runs the suite once per mutant destroys
  the fast local loop (see `kit/README.md` for the tiers).
- **But run it locally, before the push.** "Scoped to the diff" does not mean
  "only CI can compute it": `git diff <base>...HEAD` gives the same merge-base
  set on a laptop that the PR job computes on a runner. The kit ships it as
  `just mutate-diff`. Learning at PR time what you could have learned in the
  editor costs a round trip per survivor, and it teaches the agent that Tier 3
  is somebody else's problem. CI re-runs it as a **witness** — so the verdict is
  reproducible by someone other than the author — not as the first observation.
- **Exclude what mutation cannot judge**: pure I/O adapters, generated code,
  getters, `Display`/logging. Keep the exclusion list in the tool's config, next to
  the code, not in the CI file.
## Triaging a survivor — three outcomes, not one

"A mutant survived" is a symptom, not a diagnosis. Reaching for a new test every
time is how a suite fills with tests nobody needed. Ask what the mutant proves:

1. **The test is missing or asserts nothing** — the mutant changes behaviour a
   caller would notice, and nothing failed. *Fix: assert the behaviour.* This is
   the common case, and the only one that ends in new test code.
2. **The code is dead** — the mutated line can be removed or its result is never
   consumed, and the suite is right not to care. *Fix: delete the code.* A
   survivor is often an unreachable branch, a defensive check on an invariant the
   type system already holds, or a return value nobody reads. **Look for this
   before writing a test** — writing one instead permanently freezes code that
   should not exist. This is the outcome an agent almost never picks on its own,
   and the most valuable one.
3. **The mutant is equivalent** — no test could distinguish the two versions
   (`<` vs `<=` on a bound that cannot be hit, a log string). *Fix: add it to the
   exclusion list with a one-line reason.* Never chase 100%.

Prefer **delete > assert > exclude**. Exclusion is the only outcome that leaves
the codebase exactly as weak as it was: it is the escape hatch, not the default.
An exclusion list growing faster than the code is a gate on its way out — the
same death as a coverage target, one comment at a time.

## The ratchet

A quality metric introduced as a hard threshold gets disabled within a month.
Introduce it as a ratchet instead:

1. **Measure** — run it, record the per-package baseline in the repo. A healthy
   codebase often sits around 70%; a naive 75% bar would block every PR on day one.
2. **Observe, non-blocking** — `continue-on-error`, for long enough to separate
   real gaps from equivalent mutants and flakes.
3. **Ratchet** — flip to blocking at *the measured baseline*, not at a round
   number. The rule is "no lower than where we are".
4. **Only ever up.** Raising the floor is a deliberate, committed change to the
   baseline file. Lowering it is a decision that needs a reason in the commit —
   never a quiet edit to make a red PR green.

The same shape applies to any repo-level metric (bundle size, build time, lint
debt): baseline, observe, ratchet, never regress.

## Per-language note

Local recipe = what the agent runs before pushing; CI job = the witness that
re-runs it on the PR. Both ship in the kit.

- **Rust** — `cargo-mutants`, `--in-diff pr.diff`; config in `<workspace>/.cargo/mutants.toml`.
  Local: `just rust-mutate`. Reference job: `kit/rust/mutation-ci.yaml`.
- **TS** — Stryker. It has no `--since`; locally use `--incremental` (reuses the
  previous report, re-tests what changed), and in CI `--mutate` on the changed
  files, with `thresholds.break` set from the baseline once calibrated.
  Local: `just ts-mutate`. Reference job: `kit/ts/mutation-ci.yaml`.
- **Go** — mutation tooling is not production-grade; use a **coverage ratchet on
  changed packages** plus `go test -race -count=1` instead, and be explicit that it
  is the weaker signal. Locally the useful output is the map of uncovered
  statements, not the score: `just go-cover`. Reference job: `kit/go/coverage-ci.yaml`.

## Checklist

- [ ] No coverage percentage is used as a goal anywhere in CI or docs
- [ ] Mutation (or, for Go, the coverage ratchet) is runnable locally on the diff
      in one command, and CI re-runs it on the PR — never a git hook
- [ ] Survivors are triaged three ways (delete / assert / exclude), not always tested
- [ ] A baseline is committed; the gate compares against it, not a round number
- [ ] The gate starts non-blocking and is flipped deliberately
- [ ] Exclusions live in the tool config with a reason
- [ ] Lowering the baseline is a reviewed decision, never a silent edit
