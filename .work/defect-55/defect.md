# Bug — the Tier 3 review report comes back translated, and review-guard rejects it

- **Status**: diagnosed
- **Autonomy**: L3
- **Repository**: git@github.com:dohrm/claude-rules.git
- **Base branch**: next
- **Branch**: fix/defect-55
- **Ticket**: https://github.com/dohrm/claude-rules/issues/55

## Symptom

`just code-review` with `reviewer=claude` on a machine whose Claude Code settings carry
`"language": "Francais"`: the report is written in French, `### Files reviewed` becomes
`### Fichiers revus`, and the run fails with `review-guard: .work/review.tmp is
incomplete … no \`### Files reviewed\` section.` Reproduced in this repo on the #53 fix
(PR #60); seen in 3 downstream repos, one of which overrode the recipe.

## Expected behavior

The review writes a report `review-guard` can parse, whatever the user's language —
source: `rules/common/language.md` (artifacts in English), `kit/common/review-guard.mjs`
(`### Files reviewed` is matched verbatim), and the report format in
`kit/common/review-prompt.md`.

## Reproduction

- Command: `node --test --test-name-pattern="pins the report language" test/gates.test.mjs`
  (a stand-in `claude` on PATH that translates unless `--settings` pins English — the
  behavior measured below; the library's own `review-claude` recipe runs).
- Fails on: `319310a` with `no \`### Files reviewed\` section.`, report not promoted.

## Hypotheses

1. `claude -p` inherits the user-level `"language"` setting and translates the report,
   headings included — if true: the same prompt answers in French by default and in
   English under `--settings '{"language":"English"}'`; if false: English both ways →
   **confirmed**: a one-line probe returned `### Fichiers examinés` by default and
   `### Files reviewed` with the flag.
2. The prompt never states the report language, so any reviewer follows its user's
   preference — if true: adding "Write in English" to the prompt alone returns English →
   **confirmed** by the same probe (`### Files reviewed`). It covers codex and cursor,
   which read their own config.
3. `review-guard` is too strict and should accept translated headings — refuted as a
   cause: the guard's verbatim match is the contract; loosening it per language would
   widen what an incomplete report can pass as.

## Root cause

`kit/common/gate.just` `review-claude` runs `claude -p` with the user's settings, and
`kit/common/review-prompt.md` never pins the output language: the one machine-parsed
artifact of Tier 3 follows a per-user preference.

## Assumptions

- Both levers, not one: the CLI flag binds for claude; the prompt line is the only lever
  for codex and cursor (no shared flag) and costs one sentence.
- The codex rule-path note in #55 ("Related, same prompt") is a separate change — out of
  this fix.

## Blocked on the human

- none

## Log

- phase 1: zones — `gate.just` `review-claude`, `review-prompt.md`, `review-guard.mjs`.
  Repro fails on 319310a for the reported reason.
- phase 2–3: hypotheses 1 and 2 confirmed by a two-call probe, 3 refuted.
