# eval — agent regression harness (rot detector)

Agents are the **perishable** layer: a new Claude model can silently change how
`code-reviewer` / `code-simplifier` behave — a review that used to catch a bug
starts missing it. This harness catches that regression *on a model bump*
instead of in the field.

## How it works

Each case plants a **known defect** in a fixture and asserts the agent flags it
(or, for a clean fixture, asserts it does NOT raise a false alarm). The runner:

1. makes a throwaway workspace, drops the case's `input.*` in it,
2. installs the shared agent + its rules (from this repo) into `.claude/`,
3. `git init` + commit a baseline, then leaves `input.*` as the working change
   (so the reviewer has a diff to review),
4. invokes the agent **headlessly** at a chosen `--model`,
5. runs the assertions in `expect.json` against the captured output.

**Deterministic first, judge optional.** Assertions are regex/verdict checks
(cheap, reliable). An optional `--judge` runs a second model call to grade the
fuzzy criterion in `expect.json.judge` when regex can't express it.

## Running

```bash
node eval/run.mjs                     # all cases, current model
node eval/run.mjs --model <candidate> # re-run against a new model (the point)
node eval/run.mjs --judge             # also grade fuzzy criteria
node eval/run.mjs reviewer-utf8       # a single case
```

⚠️ Each case spends real tokens (it calls `claude`). Keep cases **few and
high-value** — this suite tests the perishable layer, so it must not itself
become a maintenance burden. Add a case only when it guards a real behavior.

## Case format

```
eval/cases/<name>/
  input.rs        # the fixture to review (planted defect, or clean)
  expect.json     # assertions
```

`expect.json`:
```json
{
  "stdout_matches":     ["(?i)utf-?8|byte"],   // ALL must appear in the output
  "stdout_not_matches": ["(?i)\\bpanic\\b"],   // NONE may appear
  "ci_verdict_in":      ["CRITICAL", "WARNINGS"], // the CI_VERDICT line must be one of these
  "judge": "Does the review identify the UTF-8/byte-indexing hazard on &str?"
}
```
Omit any key to skip that check. The agent + review prompt are harness defaults
(target: `code-reviewer`), so a case is just its fixture + expectations.

## v1 scope

Target the `code-reviewer` only (highest risk, most verifiable). Cases:
- `reviewer-utf8` — byte-indexing a `&str` → must flag UTF-8 hazard.
- `reviewer-unwrap` — `unwrap()` in production code → must flag it.
- `reviewer-clean` — clean code → must return `CLEAN`, no false alarm.

`code-simplifier` and more agents come later, only if the mechanism proves out.
