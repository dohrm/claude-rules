# Bug — mutation-ci / coverage-ci: "no merge base" once the PR base moves

- **Status**: diagnosed
- **Autonomy**: L2
- **Repository**: git@github.com:dohrm/claude-rules.git
- **Base branch**: next
- **Branch**: fix/bug-43
- **Ticket**: https://github.com/dohrm/claude-rules/issues/43

## Symptom

`fatal: origin/<base>...HEAD: no merge base`, exit 128, in the "Compute PR diff" step of
`kit/rust/mutation-ci.yaml`, once the base branch has commits the PR branch does not.

## Expected behavior

The Tier 4 job diffs the PR against its base and mutates the changed code, whatever the
base did since the cut — source: `rules/agent/autonomy.md` (mutation is the PR gate),
ADR-0002 (mutation is a PR gate).

## Reproduction

- Command: `.work/bug-43/repro.sh kit/rust/mutation-ci.yaml` (runs the step's own `run:` block, taken from the YAML, in a full clone of a PR whose base moved)
- Fails on: `2e41a5e` with `fatal: origin/base...HEAD: no merge base`, exit 128

## Hypotheses

1. `git fetch --depth=1` turns the full clone shallow, with the base tip as the boundary, so the merge base is cut off — if true: `.git/shallow` holds the base tip after the fetch, and a full fetch finds the merge base; if false: the repo stays complete → **confirmed**: shallow before = false, after = true, boundary = base tip; a full fetch finds the merge base `A`.
2. The checkout is shallow despite `fetch-depth: 0` (runner-specific) — if true: `--is-shallow-repository` is true before the fetch → **refuted**: false before the fetch; the repro fails on a full local clone, no runner involved.
3. `origin/<base>` is stale and the diff reads an old ref — if true: `origin/base` differs from `FETCH_HEAD` → **refuted**: both are the base tip.

## Root cause

`--depth=1` in `git fetch --no-tags --depth=1 origin "${{ github.base_ref }}"`:
`kit/rust/mutation-ci.yaml` § "Compute PR diff", and `kit/go/coverage-ci.yaml`
§ "Which changed lines are untested". In coverage-ci the failure is **silent**: the
`git diff` sits in a pipeline ending in `|| true`, so `changed.txt` is empty and the
step reports "(none)" uncovered statements.

## Assumptions

- Ran at L2 (stop after the diagnosis): the proof case of RFC #44, which asks for a diagnosis, not the fix.

## Blocked on the human

## Log

- phase 1: two zones (both snippets' fetch lines); `repro.sh` fails on `2e41a5e` with exit 128.
- phase 2: three hypotheses, as above.
- phase 3: instrumented a scratch copy of the repro (`[DEBUG-7c1e]`, never in the tree); H1 confirmed, H2 and H3 refuted.
