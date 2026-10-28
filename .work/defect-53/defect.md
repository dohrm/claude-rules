# Bug — `ci-ok` reports success on Gitea while gate jobs failed

- **Status**: done
- **Autonomy**: L3
- **Repository**: git@github.com:dohrm/claude-rules.git
- **Base branch**: next
- **Branch**: fix/defect-53
- **Ticket**: https://github.com/dohrm/claude-rules/issues/53

## Symptom

On Gitea Actions, the `ci-ok` job of `kit/cicd/ci.snippet.yaml` succeeds while jobs it
`needs` failed. Its log prints `gate results: ` followed by nothing. Seen in two
downstream repos on two runners: one run with `go` red, one with `rust-linux` and
`rust-macos` red, `ci-ok` green both times.

## Expected behavior

`ci-ok` fails unless every job it needs actually succeeded — a failed or skipped gate
never reads as green. Source: `rules/cicd/pipeline.md:62` ("A skipped required check
must not read as green"), `skills/ci-setup/SKILL.md:61`, the snippet's own comment
above `ci-ok`, and `ci.snippet.yaml:9` ("the syntax is the same" on both forges).

## Reproduction

- Command: `node --test test/cicd.test.mjs`
- Fails on: `319310a` with 3 failures — `ci-ok on gitea: one gate red → red`,
  `ci-ok on gitea: one gate skipped → red`, `ci-ok fails closed when a result expands
  to nothing` (`actual: 0`, log `gate results: ` empty). The GitHub cases pass.

## Hypotheses

1. The aggregator fails open: it iterates over the results it received, never over the
   jobs it expects, so an empty expansion is "nothing failed" — if true: an empty
   `RESULTS` exits 0 on any forge; if false: it exits non-zero → **confirmed**: the
   forge-independent case `fails closed when a result expands to nothing` exits 0 on
   the base.
2. Gitea's runner expands the `needs.*` object filter to nothing, while it expands a
   named `needs.<job>.result` — if true: a step reading each job by name sees the real
   results on Gitea; if false: named results are empty too → **confirmed downstream**:
   one repo replaced the join with one `env:` line per named job, and its later runs
   fail `ci-ok` when a gate fails. Not reproducible here (no Gitea runner); the test
   models that expansion.
3. The whole `needs` context is empty on Gitea under `if: always()` — if true: named
   results are empty as well; if false: they are populated → **refuted** by the same
   downstream fix.

## Root cause

`kit/cicd/ci.snippet.yaml`, job `ci-ok`: `RESULTS="${{ join(needs.*.result, ' ') }}"`
then `for r in $RESULTS` — a check whose only input is the list of results, so no input
passes. Gitea's empty expansion of `needs.*` (hypothesis 2) is the trigger; the fail-open
loop (hypothesis 1) is the defect.

## Assumptions

- Gitea's expansion is taken from two downstream repos, not reproduced on a runner —
  the test encodes it, and the fix relies only on named `needs.<job>.result`, which works
  on both forges.
- The other Gitea gotchas listed in #53 (profile not sourced, bare `uses:` resolving to
  github.com, `upload-artifact@v4`, `continue-on-error` conclusion) are documentation,
  not this defect — out of this fix.

## Blocked on the human

- none

## Log

- phase 1: zones — `kit/cicd/ci.snippet.yaml` (`ci-ok`), `rules/cicd/pipeline.md`
  (forge note), `skills/ci-setup` (aggregator wiring). Repro `test/cicd.test.mjs` fails
  on 319310a, 3/7, for the reported reason.
- phase 2–3: hypothesis 1 confirmed by the repro, 2 by downstream evidence, 3 refuted.
- human: diagnosis validated; `/defect fix` asked at L3 (level raised by the human).
- phase 4: repro re-run on 319310a + diagnosis commit, still 3/7 failing. Fix: `ci-ok`
  reads each `needs.<job>.result` by name through `env:`, fails on an empty or
  non-`success` one, `shell: bash`; a test holds `needs`, `env` and the loop equal.
  Forge note in `rules/cicd/pipeline.md`, CHANGELOG hand-merge entry. Repro 8/8 green.
- `npm test`: 492 pass, 2 fail — `python-gates` (`pip-audit` finds new advisories in the
  fixture's `uv.lock`: certifi, filelock). Same 2 failures on 319310a: pre-existing,
  external, tracked in #50. Not bypassed.
- Tier 3: `just code-review` ran (claude). The report was not promoted: written in French,
  `### Files reviewed` missing — #55 reproduced here. Its findings read and applied: this
  repo's own `.github/workflows/ci.yml` `ci-ok` moved to the named form, and the test
  covers both files (16 cases). Re-review after #55 lands.
- `npm test`: 500 pass, 2 fail — same 2 `python-gates` cases as on 319310a (#50).
- PR #60 opened against next; the human merges it.
