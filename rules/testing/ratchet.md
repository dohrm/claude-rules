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
  runs take hours; a PR-scoped run takes minutes.
- **Tier 3 only** — a PR/CI gate, never a git hook. Anything that re-runs the suite
  once per mutant destroys the local loop (see `kit/README.md` for the tiers).
- **Exclude what mutation cannot judge**: pure I/O adapters, generated code,
  getters, `Display`/logging. Keep the exclusion list in the tool's config, next to
  the code, not in the CI file.
- **Equivalent mutants exist** — some survivors are unkillable because the change
  is semantically identical. Triage them into the exclusion list with a comment;
  never chase 100%.

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

- **Rust** — `cargo-mutants`, `--in-diff pr.diff`; config in `<workspace>/.cargo/mutants.toml`.
  Reference job: `kit/rust/mutation-ci.yaml`.
- **TS** — Stryker, scoped to changed files, `thresholds.break` set from the
  baseline once calibrated. Reference job: `kit/ts/mutation-ci.yaml`.
- **Go** — mutation tooling is not production-grade; use a **coverage ratchet on
  changed packages** plus `go test -race -count=1` instead, and be explicit that it
  is the weaker signal. Reference job: `kit/go/coverage-ci.yaml`.

## Checklist

- [ ] No coverage percentage is used as a goal anywhere in CI or docs
- [ ] Mutation (or, for Go, the coverage ratchet) runs on the PR diff, in CI only
- [ ] A baseline is committed; the gate compares against it, not a round number
- [ ] The gate starts non-blocking and is flipped deliberately
- [ ] Exclusions live in the tool config with a reason
- [ ] Lowering the baseline is a reviewed decision, never a silent edit
