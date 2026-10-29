# Bug — a mutation job killed from outside is reported green

- **Status**: done
- **Autonomy**: L3
- **Repository**: https://github.com/dohrm/claude-rules
- **Base branch**: next
- **Branch**: fix/mutation-ci-false-green
- **Ticket**: none — reported from the hwe-platform run that measured #70

## Symptom

hwe-platform, Gitea, `kit/rust/mutation-ci.yaml` as shipped by #70/#71:

```
Found 468 mutants to test
ok       Unmutated baseline in 193s build + 111s test
 INFO Auto-set test timeout to 336s
error: recipe `rust-mutate` was terminated on line 148 by signal 15
ERROR interrupted
Error: this step has been cancelled: Process completed with exit code -1.
```

The run shows **success**. No mutant was measured.

## Expected behavior

A calibration run is non-blocking on its **findings** (survivors), not on its own
failure: a run that measured nothing is not green — source: `rules/testing/ratchet.md`
§ The ratchet, step 2 ("Observe, non-blocking … for long enough to separate real gaps
from equivalent mutants and flakes": the non-blocking state exists to observe findings),
and `rules/agent/autonomy.md` § Never fake green ("The green must be true").

## Reproduction

- Command: `node --test --test-name-pattern='continue-on-error|tolerates survivors' test/cicd.test.mjs`
  — the Rust step's script run with a stub `just` per exit code, and the four snippets
  read for a job-level `continue-on-error`.
- Fails on: `8ef2d3d` — every snippet carries job-level `continue-on-error: true`, and the
  Rust step returns 4 (failed baseline) unchanged, which that key turns green.

## Hypotheses

1. Job-level `continue-on-error: true` turns every job outcome green — a survivor, but
   also a crash, a failed baseline, a timeout, a cancellation — if true: a job whose
   step was cancelled reports success; if false: it reports failed or cancelled →
   **confirmed**: the hwe-platform run (step cancelled, job green); GitHub's
   documentation of the key ("prevents a workflow run from failing when a job fails").
2. The recipe swallows the signal and exits 0 — if true: the step ends with exit 0; if
   false: non-zero → **refuted**: just reports `terminated … by signal 15`, the step
   exits -1.
3. An `always()` upload step after the failure overrides the job's result — if true: the
   job is green without `continue-on-error`; if false: red → **refuted**: a step's
   success never overrides an earlier step's failure on either forge; only the key
   explains a green job after a failed step.

## Root cause

`continue-on-error: true` sits on the **job** in `kit/rust/mutation-ci.yaml`,
`kit/ts/mutation-ci.yaml`, `kit/python/mutation-ci.yaml` and `kit/go/coverage-ci.yaml`,
so it tolerates every failure instead of the findings only. Per tool (verified):

| Snippet | A finding during calibration exits | So the job-level key masks |
|---|---|---|
| Rust — cargo-mutants 27.1 | 2 (missed), 3 (timeout) | 1, 4 (failed baseline), 5, 6, 70, cancellation |
| TS — Stryker, `thresholds.break: null` (default) | 0 | only failures |
| Python — mutmut 3 (`run` never exits non-zero on survivors) | 0 | only failures |
| Go — ratchet at the committed `0.0` baseline | 0 | only failures (`go test -race` included) |

Second, latent: `rust-mutate`'s empty-range guard (`kit/rust/rust.just`) exits **2**,
cargo-mutants' "missed mutants" code. Tolerating 2 in the step would let a failed
`ci-base` pass again.

## Assumptions

- Autonomy L3 — the project default for `/defect` (`CLAUDE.md` § Working rules); none passed at launch.
- All four snippets, not Rust alone — same root cause, same key; the human asked "Rust
  only or all four" and this run settles it on the root cause.
- Exit 3 (timeouts) is a finding, tolerated with 2 — cargo-mutants' own wording: "probably
  the mutant caused an infinite loop, or the timeout is too low".
- The external SIGTERM itself (timeout, runner limit or superseded run) is hwe-platform's,
  out of this fix: the kit's part is that it must not read green.

## Blocked on the human

## Log

- phase 1–3: root cause confirmed (hypothesis 1); tool exit codes checked at the source
  (cargo-mutants `src/exit_code.rs`, mutmut `__main__.py`, Stryker configuration docs).
- phase 4: repro re-run on the base, fails as recorded (`continue-on-error` found; exit 2 not tolerated). Fix: no job-level `continue-on-error` in the four snippets; the Rust step tolerates 2 and 3 only; the empty-range guard exits 1. `PYTHON_GATES=1 GO_GATES=1 RUST_GATES=1 just check` → 554 pass, 0 fail, 7 skipped (Godot).
- review rounds: (1) ADR-0002 amended; removing the mask exposed a false red — the TS/Python changed-files `grep` fails under Gitea's default `pipefail` on a PR with no source file — fixed, tested; (2) grep tolerance narrowed to exit 1; (3–4) per-grep test, its stub drains stdin so a SIGPIPE cannot stand in for the guard — each guard mutated by hand, each mutant killed. Review CLEAN at 6400f0d. `just check` → 555 pass, 0 fail, 7 skipped (Godot).
