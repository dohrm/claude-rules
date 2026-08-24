---
paths:
  - "**/*.rs"
  - "**/*.go"
  - "**/*.py"
  - "**/*.ts"
  - "**/*.tsx"
title: "Testing — Coverage, Mutation & the Ratchet"
---

Most of this code is written by an agent, and an agent can produce a suite that
executes every line while asserting nothing. Coverage cannot see that. **Mutation
score can**: it changes the code and asks whether any test notices.

```bash
just mutate-diff     # the locked techs' mutate / cover recipes; never a hook
```

CI re-runs the same recipes as a **witness**. Wiring and tool limits (Stryker has
no `--since`, mutmut is path-scoped, Go has no production-grade mutator): the
language kit README. `just mutate-diff` does not see whether a survivor should
be deleted, asserted, or excluded.

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

- **Scope it to changed code.** Whole-repo mutation runs take hours; a diff-scoped
  run takes minutes.
- **Never a git hook.** Anything that re-runs the suite once per mutant destroys
  the fast local loop (see `kit/README.md` for the tiers).
- **But run it locally, before the push.** `git diff <base>...HEAD` gives the same
  merge-base set on a laptop that the PR job computes. Learning at PR time what
  you could have learned in the editor costs a round trip per survivor.
- **Exclude what mutation cannot judge**: pure I/O adapters, generated code,
  getters, `Display`/logging. Keep the exclusion list in the tool's config, next to
  the code, not in the CI file.

| Lang | Recipe | Tool |
|---|---|---|
| Rust | `just rust-mutate` | cargo-mutants `--in-diff` |
| TS | `just ts-mutate` (or `ts-web-mutate` / `ts-node-mutate` / `ts-tauri-mutate`) | Stryker `--incremental` |
| Python | `just python-mutate` | mutmut, path-scoped |
| Go | `just go-cover` | coverage map — weaker signal, named as such |

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
debt, `just dup-check`): baseline, observe, ratchet, never regress.
