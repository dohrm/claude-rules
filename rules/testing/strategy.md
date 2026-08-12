---
paths:
  - "**/*.rs"
  - "**/*.go"
  - "**/*.py"
  - "**/*.ts"
  - "**/*.tsx"
title: "Testing — Strategy"
---

A test exists to make a behavior **hard to break by accident**. If it can't fail
for a reason a user would care about, delete it.

## Where a test belongs

- **Unit** — a pure decision: domain rules, parsing, state transitions, error
  mapping. No I/O, no clock, no network. This is where the bulk of the suite lives
  because it is where the bugs that matter live.
- **Integration** — one real boundary at a time: the repository against a real
  database, the handler against a real router, the client against a real server.
  Real dependency over mock whenever it can start in seconds (container, in-memory
  engine, temp dir).
- **End-to-end** — a handful, on the money paths only. They are slow and they rot;
  they are a smoke signal, never the safety net.

Push a test **down** the levels whenever the same failure could be caught lower.
An e2e test that fails because of a wrong tax rate is a unit test wearing a costume.

## Rules

- **One behavior per test**, named after that behavior — `rejects_expired_token`,
  not `test_auth_2`. The name is what a reader sees when CI goes red.
- **Arrange–act–assert**, in that order, visible at a glance. No assertion inside
  a loop that hides which iteration failed.
- **Deterministic or it does not ship**: no `sleep`, no wall-clock or timezone
  dependence, no reliance on map/set iteration order, no shared mutable state
  between tests. Inject the clock and the RNG.
- **Assert the observable outcome**, not the interaction. Asserting "the
  repository was called once" locks in the implementation; asserting the stored
  record locks in the behavior. See the AI-slop list in `agent/guardrails.md` —
  tests that only assert construction, and mocks returning mocks, are review
  blockers.
- **Mock only what you cannot run**: a paid third party, a clock, a device.
  Never mock the type you own and are testing through.
- **Fixtures are builders with defaults**, not shared global data. Each test states
  the *one* field it cares about; everything else comes from the default.
- **Test the error paths.** A codebase where only the happy path is covered has no
  coverage of the code that runs on the worst day.
- **Every bug fix arrives with the test that fails without it.** That test is the
  proof the cause was found, not just the symptom.

## Flaky tests

A test that fails intermittently is worse than no test: it trains the team to
ignore red. On the second observed flake:

1. **Quarantine it** (skip/ignore with the marker your toolchain provides) — never
   paper over it with a retry, a longer sleep, or a rerun-on-failure CI flag.
2. **Open an issue** linked from the skip annotation, naming the suspected source
   of nondeterminism.
3. **Put a date on it.** If it is not fixed by then, delete the test. A permanently
   skipped test is a lie in the suite.

Retries are acceptable only at the e2e level, against a genuinely remote system,
and the retry must be logged and counted — never silent.

## Per-language note

- **Rust** — unit tests in a `#[cfg(test)] mod tests` next to the code, integration
  tests in `tests/`. `#[should_panic]` only with `expected =`. Prefer
  `assert_eq!(expected, actual)` over hand-rolled comparisons; `insta` for snapshots.
- **Go** — table-driven subtests (`t.Run`) with a named case per row, `t.Parallel()`
  where there is no shared state, `t.TempDir()`/`t.Cleanup()` over manual teardown.
  Always run the suite with `-race`.
- **TS** — Vitest/Jest with React Testing Library: query by role and accessible
  name, never by class or test-id-of-convenience. `userEvent` over `fireEvent`;
  fake timers over sleeps; MSW at the network boundary rather than mocking `fetch`.

## Checklist

- [ ] The failure this test catches is one a user would notice
- [ ] It could not have been caught one level lower
- [ ] Name states the behavior; one behavior per test
- [ ] No sleep, no real clock, no cross-test shared state
- [ ] Asserts the outcome, not the calls
- [ ] Error paths covered, not just the happy path
- [ ] Any flake is quarantined with an issue and a deletion date
