# eval — agent regression harness (rot detector)

Agents are the **perishable** layer: a new Claude model can silently change how
`code-reviewer` / `code-simplifier` behave — a review that used to catch a bug
starts missing it. This harness catches that regression *on a model bump*
instead of in the field.

> This is the **token-spending** half of the repo's self-verification. The other
> half — `npm test`, which covers the installer and the asset tree — is
> deterministic, free, and runs on every PR. Only this one is manual.

## How it works

Each case plants a **known defect** in a fixture and asserts the agent flags it
(or, for a clean fixture, asserts it does NOT raise a false alarm). The runner:

1. makes a throwaway workspace, drops the case's `input.*` in it,
2. installs the case's target agent + its rules (from this repo) into `.claude/`,
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
  "agent":              "code-reviewer",       // default; or "code-simplifier"
  "rules":              ["rust", "agent"],     // default: common, agent, rust, hexagonal, testing
  "prompt":             "…{file}…",            // default: the per-agent prompt in run.mjs
  "stdout_matches":     ["(?i)utf-?8|byte"],   // ALL must appear in the output
  "stdout_not_matches": ["(?i)\\bpanic\\b"],   // NONE may appear
  "file_matches":       ["pub fn resolve_label"],   // on the fixture AFTER the run
  "file_not_matches":   ["\\.clone\\(\\)"],
  "file_changed":       true,                  // the agent must (or must not) have edited it
  "ci_verdict_in":      ["CRITICAL", "WARNINGS"], // the CI_VERDICT line must be one of these
  "judge": "Does the review identify the UTF-8/byte-indexing hazard on &str?"
}
```
Omit any key to skip that check. Everything has a default, so a case is usually
just its fixture + a couple of expectations.

**Assert on the artifact, not the claim.** For a reviewing agent the output *is*
the artifact (`stdout_*`, `ci_verdict_in`). For an editing agent the report is
only what it *says* it did — the resulting file is the truth (`file_*`).

## Scope

`code-reviewer` (highest risk, most verifiable):
- `reviewer-utf8` — byte-indexing a `&str` → must flag UTF-8 hazard.
- `reviewer-unwrap` — `unwrap()` in production code → must flag it.
- `reviewer-clean` — clean code → must return `CLEAN`, no false alarm.

`code-simplifier`:
- `simplifier-nesting` — needless clone + `else`-after-`return` + a nested `if` in
  a match arm → must flatten them **and** keep the signature and the tests intact.

Keep it at that unless a new case guards a behavior a real change depended on.
