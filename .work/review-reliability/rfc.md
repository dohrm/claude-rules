# RFC — Make Tier 3 review reliable on `next`: deterministic RFC context, checked coverage, optional OCR pass

- **Status**: implementing
- **Autonomy**: L3
- **Repository**: git@github.com:dohrm/claude-rules.git
- **Base branch**: next
- **Branch**: rfc/review-reliability-2
- **Stopping condition**: `npm test` green on the last phase's branch, and the pilot hold
  (Phase 4) checked on temper-altern
- **Serves**: —
- **Constrained by**: ADR-0003 § Decision (the reviewer agent is emitted for Claude only;
  the headless prompt is what every CLI runs), ADR-0005 § Decision (feature-local choices
  live here, not in ADRs; shared decisions bind like Accepted ADRs; in-place exceptions),
  ADR-0007 § Decision and amendment (Tier 3 runs once per RFC phase)

## Request

> fesons une petite analyse de notre skill code-review par rapport à https://github.com/alibaba/open-code-review

> est ce que ca ne ferais pas de sens de les integrer simplement ? pas en obligatoire, mais si précisé, alors ajouter un step ocr dans notre code review ?

> Je partirais sur le B, ensuite pour notre probleme de gros diffs, est ce qu'on ne pourrais pas s'inspirer d'eux pour le regler ?

> Je pense que le context de la review n'est pas vraiement le fichier rfc vue qu'il ne stock que la référence. Il faudra a mon avis l'alimenté avant de lancer la review.
> actuellement c'est une instruction agent qui explicite comment récupérer le ticket (gh, tea, file, ...)
> On devrais probablement revoir ca ?

> projet d'exemple : ~/devs/temper-alter (et ses worktree)

> Oui, on va rester pour le moment en mode local, ensuite une fois stabilisé on passera en mode ticket gh.

## Goal

`just code-review` reviews a phase with the context it was framed in, proves it looked at
every file of the diff, and can optionally take OCR's findings as leads, so a `CLEAN` means
"every file was read, against its RFC", not "a model said so". For the maintainer and every
consuming repo running Tier 3, first piloted on temper-altern.

## Scope

- In:
  - the branch → RFC slug resolution shared by the gate scripts;
  - a review context the implementing agent caches from a ticket RFC, and the injection
    of the RFC into the review prompt (local and ticket mode);
  - the review contract catching up with ADR-0005 (shared decisions, in-place exceptions,
    RFC local decisions);
  - a `Files reviewed` section and parseable `Location`s, checked by `review-guard`
    before a report is promoted;
  - an opt-in OCR pass whose findings reach the reviewer as candidates.
- Out:
  - splitting a diff into shards (measure on real phases first; the size failure now
    points to the phase cut);
  - fetching the shared decision repository: no project declares one yet;
  - tracker access as just recipes, reads or writes: the project's adapter, used by the
    agent, stays the only access;
  - moving this RFC to ticket mode (after stabilization, the human's call);
  - the pre-push hook's behavior (`review-guard` without arguments is unchanged).

## Local decisions

- Slug resolution order: `work_slug` override → the `.work/*/rfc.md` whose `**Branch**`
  header equals the current branch → the sanitized branch name (today's behavior) — one
  resolver, used by `diff-since` and the review recipes, so the marker and the RFC share a
  directory. temper-altern shows the bug: branch `rfc/19-deliver-composition`, marker in
  `.work/rfc-19-deliver-composition/`, RFC in `.work/19-deliver-composition/`.
- An explicit `**Branch**` header in the RFC, not a `rfc/<slug>` naming convention — a
  phase branch keeps its own name, and the implementer updates the header per phase. A
  tree may hold several committed RFCs (temper's holds 03, 17, 19, two `implementing`),
  so "the one implementing" is not unique.
- In ticket mode, the implementing agent writes `.work/<slug>/review-context.md` at
  `/rfc implement` and refreshes it before each phase's `just code-review`, through the
  adapter it already uses: the tracker's read output redirected raw (body, comments), under
  a header with source URL, fetch time and HEAD sha. No per-project recipe — the access is
  already the adapter's, and it works the same under every agent. Raw output, not prose
  the agent writes: the author must not paraphrase its own reviewer's context.
- Not `ticket-context.md`: that name is the pre-fetched context a next run trusts without
  fetching again, so a cache left by `/rfc implement` would be trusted stale. Gitignored
  (`*/review-context.md`, added by the same `ensureIgnored` as the markers): it holds
  ticket comments.
- The injected RFC omits `## Revisions` and `## Log`: history, not state.
- Missing or failed context is declared in the prompt (`RFC context not available:
  <reason>`) and reported as a 🟡, never blocking: absent context does not make code unsafe,
  and the ADR index stays readable.
- Coverage and `Location` checks run on the temp report BEFORE it is promoted: a failure
  leaves the previous report standing and the marker unmoved, like a dead CLI. Checking the
  promoted report would let the pre-push guard pass an incomplete `CLEAN`.
- A `Location` is valid when its file exists at HEAD and its line is within the file — a
  deterministic floor, not a content match.
- OCR runs through `npx @alibaba-group/open-code-review@<pin>`, pinned to the newest
  release at least 14 days old when implemented (1.12.11 or older as of 2026-10-11), behind
  an `ocr_cmd` variable so tests substitute a shim.
- OCR findings are candidates: the reviewer confirms each against the code or drops it; it
  stays the only verdict. `--background-file` gets the same RFC context.

## Steps

### Phase 1 — The review finds its RFC and reads it → proof: `node --test test/gates.test.mjs`

- [x] Shared slug resolver (`kit/common/work-slug.mjs`, used by `diff-since.mjs`) —
  touches `kit/common/diff-since.mjs` (`slug`, `sanitize`), `kit/common/gate.just`
  (`since_scope`) → proof: a test with temper's shape puts the marker in
  `.work/19-deliver-composition/`
- [x] `**Branch**` header in `<rfc-body>`, set per phase at implementation, and in the
  ticket-mode pointer header — touches `skills/rfc/SKILL.md`, `skills/rfc/ticket.md`
  § Implementation → proof: `node --test test/skills.test.mjs`
- [x] Ticket mode writes and refreshes `review-context.md` (at `/rfc implement`, then
  before each phase's review); `ensureIgnored` adds `*/review-context.md` — touches
  `skills/rfc/SKILL.md` § Implement, `skills/rfc/ticket.md` § Implementation,
  `kit/common/diff-since.mjs` → proof: `npm test`, and `.work/.gitignore` carries the
  pattern
- [x] `kit/common/review-context.mjs <slug>` prints the `=== RFC ===` section (local body,
  else `review-context.md` with its fetch time, else the declared reason); `code-review`
  and `review-with` append it before the diff, inside `review_max_bytes` — touches
  `kit/common/gate.just` → proof: tests for local, ticket (fixture cache), missing cache
- [x] Contract: read the `=== RFC ===` section instead of opening `rfc.md`; unavailable
  context is a 🟡 — touches the shared block of `agents/code-reviewer.md` and
  `kit/common/review-prompt.md` → proof: `node --test test/registry.test.mjs`
- [x] `ticket.md` § Pre-fetched context: say that `review-context.md` is a review cache,
  never pre-fetched context — touches `skills/rfc/ticket.md` → proof: `npm test`

### Phase 2 — The contract catches up with ADR-0005 → proof: `node --test test/registry.test.mjs`

- [x] An Accepted shared decision named in the RFC context binds like an Accepted ADR (🔴,
  cite the record) — touches the shared block → proof: registry test
- [x] In-place exceptions: with its reason → compliant; without → 🟡; the same exception
  recurring → 🔵 "the rule is wrong" — touches the shared block → proof: registry test
- [x] Code contradicting an RFC local decision → 🟡 at most, citing the decision — touches
  the shared block → proof: registry test

### Phase 3 — Coverage and locations are checked → proof: `node --test test/gates.test.mjs`

- [ ] Contract: a `### Files reviewed` section listing every file of the diff under
  review, and `Location` as `path:line` or `path:start-end` — touches the shared block →
  proof: registry test
- [ ] `review-guard.mjs --expect-files <file>`: a missing file or an unresolvable
  `Location` fails as incomplete; `code-review` writes the reviewed file list and runs the
  check on `review_out` before `mv` — touches `kit/common/review-guard.mjs`,
  `kit/common/gate.just` → proof: one test per arm (complete, missing file, bad location,
  promoted report untouched on failure)
- [ ] The size failure names the phase cut; `/rfc` sizes a phase so its diff fits
  `review_max_bytes` — touches `kit/common/gate.just`, `skills/rfc/SKILL.md` § Draft →
  proof: `npm test`

### Phase 4 — Optional OCR pass → proof: `npm test`

- [ ] Confirm, on the pinned release's source, that OCR's review tools cannot write or run
  a shell — touches nothing; recorded in `## Log` → proof: the tool list read from the tag
- [ ] `ocr`, `ocr_version`, `ocr_cmd` variables; with `ocr=1`, `code-review` runs
  `review --audience agent --format json --output .work/ocr.json --from <review_from> --to
  HEAD --background-file <context>`, and `kit/common/ocr-candidates.mjs` appends
  `=== OCR CANDIDATES ===` or `OCR pass not run: <reason>` — touches
  `kit/common/gate.just` → proof: tests with an `ocr_cmd` shim (findings, failure, off)
- [ ] Contract: candidates are leads to verify; one line states candidates read and
  confirmed — touches the shared block → proof: registry test
- [ ] Wiring doc: opt-in, own LLM provider (`ocr config provider`), API cost — touches
  `kit/common/README.md`, `registry.json` (`kit/common` wire) → proof: `npm test`
- [ ] ⏸ hold until the human updates temper-altern's kit from this branch and runs `just
  code-review` (then `just ocr=1 code-review`) on `rfc/19-deliver-composition`, after
  `/rfc implement` resumed #19 — check: `.work/19-deliver-composition/review-context.md`
  holds issue #19's body, the prompt carries it under `=== RFC ===`, the report has `Files reviewed` with every
  diff file, the marker lands in `.work/19-deliver-composition/`

## Open questions

- Does OCR's `--from` accept a commit sha in merge-base mode, as our incremental marker
  needs? — the pinned CLI, at Phase 4 step 2; fallback: pass `base` and let our reviewer
  scope.

## Assumptions

- Verdict: one RFC. Phase 2 is the most separable part, kept here because it edits the
  same `shared:review-contract` block as Phases 1, 3 and 4 — two RFCs on the same lines.
  Recorded at L3 instead of stopping.
- No shared decision repository exists in any consuming repo yet (temper-altern declares
  none), so fetching one is out of scope; the contract still states how such a record
  binds.

## Blocked on the human

## Revisions

- round 1: draft — verdict, four phases, local decisions, pilot hold on temper-altern.
- round 2: the implementing agent caches the ticket in `review-context.md` (at `/rfc
  implement`, refreshed per phase) instead of a project `rfc-context` recipe; the
  `ticket-context.md` name is avoided (trusted as pre-fetched context); the `gh` "who set
  ready" question and the `/architect`/`/onboard` steps leave the RFC.

## Log

- Phase 1 step 1: `work-slug.mjs` (resolver + `ensureWorkIgnored`), `diff-since.mjs` uses
  it — temper-shape test green.
- Phase 1 step 2: `**Branch**` in `<rfc-body>`, § Implement, ticket pointer header.
- Phase 1 steps 3–6: `review-context.mjs`, injected in `code-review` and `review-with`;
  contract reads `=== RFC ===`; `ticket.md` cache + not-pre-fetched note — `npm test`
  352 pass. `changed: missing context — "No RFC for this branch" is said plainly and is
  not a 🟡 (loops and ad hoc work have none); only a ticket without cache, several RFCs
  claiming the branch, or a read error is "not available"`. `changed: cache header — the
  agent writes a `Fetched <time> at <sha> from <URL>` line before the raw output (the
  script cannot know the sha at fetch time)`.
- Phase 1 review (sub-agent, review-prompt.md contract) at 2447e27: WARNINGS — ambiguous
  branch reviewed as "no RFC", unguarded reads, cache without sha, ignore pattern not
  guaranteed at first write, stale comments; header-only field matching (🔵). All fixed.
- Phase 1 re-review at 0d9f78d: CLEAN. Pushed `rfc/review-reliability-1`, PR to `next`.
- Phase 2: shared decisions, in-place exceptions, RFC local decisions in the shared
  contract (+ output-format section labels) — registry test green.
- Phase 2 review at 5a466ea: WARNINGS — `changed:` entries invisible once `## Log` is cut;
  shared-decision 🔴 on an unread record; "do not flag" contradicting evidence-not-claims;
  🔵 label. Fixed: Log's `changed:` bullets kept under `## Changed decisions`, 🔴 only
  once read (unread named record → 🟡), waivers still checked and never waive an ADR.
