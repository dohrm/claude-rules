---
name: adr-review
description: "Triage an existing ADR corpus and shrink it: one verdict per record (keep, move, gate, shared, delete, collapse), content moved before its record is deleted, references rewritten, size measured before and after. Use on /adr-review, \"clean up the ADRs\", \"too many ADRs\", or a large, superseded or contradictory decision log. For one challenged architecture choice, use /solution-exploration."
---

# Triage the decision corpus

The goal is a **smaller** corpus: a few records holding cross-cutting
arbitrations, absolute rules held by a check, product rules in documents that are
amended in place. Git is the archive: a deleted record stays readable in history,
so deletion is the default fate of a record that no longer arbitrates anything.
Read the project's decision rules if installed (`agent/decisions.md`,
`agent/decision-records.md`); this procedure and the human status boundary below
still apply with a product-only install.

## 1. Inventory and measure

List `docs/adr/` and its index (usually the decision log in
`docs/ARCHITECTURE.md`). Record the **corpus totals** — records, words, ≈ tokens
at 1.35 per word. `adr-check` prints them when the installed kit has them;
otherwise count with `wc -w`. They are the "before" column of the final table.

Read every record: explicit status line (never infer status from a title or a
date), decision, successor, references. Read the corpus's own status words (`Rejeté`,
`Refusé`, `Remplacé par`, …) as their English equivalents everywhere below.
Read the shared decision repository named in `docs/ARCHITECTURE.md` (ask for it
if absent; `none` is an answer). Use code, product documents and history
selectively to check whether an apparent conflict or obsolete premise is real;
distinguish evidence from suspicion and mark what still needs verification.

## 2. One verdict per record

Every record gets exactly one verdict from this closed set, with its evidence:

| Verdict | When | Destination |
|---|---|---|
| `keep` | A cross-cutting, hard-to-reverse arbitration that refused real alternatives; or a record whose fate waits on a human (`Proposed`, or a successor not yet `Accepted`) | stays |
| `move → <home>` | Product, design or domain content; a stack convention | PRD, `DESIGN.md`, `EXPERIENCE.md`, a domain document (`CONTEXT.md`, `DATA-MODEL.md`); the installed rules |
| `gate` | An absolute rule a check or test can hold | a check the project builds; the record may stay as its reason |
| `shared` | Enterprise policy (security, secrets, identity, data protection, deployment) | a PR on the shared decision repository, then a pointer |
| `delete` | Obsolete, `Deprecated`, `Rejected` with a refusal that no longer recurs, or a feature-local choice its PR already holds; nothing worth moving | git history |
| `collapse` | Superseded, or `Rejected` while its refusal still prevents a recurring proposal | deleted; the one line it still needs goes to the record in force, else its topic's home |

The homes follow `agent/decisions.md` § Which choices need an ADR — invent none.
For `gate`, state the rule in one line and the evidence that it is forgotten while
coding: review reports, review comments, fix commits
(`git log -S`, `git log --grep`). A rule nobody forgets is not a gate candidate.
List gates as candidates; building them is the project's own work. For `shared`,
prepare the shared-repository PR as a `Proposed` record and ask before opening it.

For `collapse`, the refusal still needed becomes one line — the refused option and
the trade-off that killed it — under `Alternatives considered` of an `Accepted`
record: the successor of a superseded one, or, for a `Rejected` one, the record
whose scope the refused option would have changed. With no such record, the line
goes to its topic's home (the table above); with none, git holds it.

One `Proposed` record may consolidate several `keep` records only when they express
one coherent decision; choices that can be accepted independently stay separate.

## 3. Move then delete

Content moves **in the same diff** that removes its record; the human's merge of
that PR is the act. Never delete a record before what it holds worth keeping
exists at its destination.

- **Execute** only deletions whose fate is mechanical: the record's own status
  line, set by a human, reads `Rejected`, `Deprecated`, or `Superseded by ADR-XXXX`
  with ADR-XXXX `Accepted` on disk. Never a `Proposed` or `Accepted` record.
  `git log -L '/Status/,+1:<file>'` shows the commit that set the line; git
  authorship does not prove a human (agents often commit under the human's
  identity), so when that commit's message or context cannot rule out an agent,
  propose the deletion instead. For
  each executed `Rejected` deletion, the triage PR's description says where its
  refusal went, or why it no longer matters: the diff only shows a file leaving.
- **Propose** every other `delete`, `move` or `collapse` in the triage table and
  execute it once the human answers.
- **Refuse**: deleting a `Proposed` record (a human withdraws it to `Rejected`
  first); deleting a superseded record whose successor is not `Accepted` (it is
  `keep` until then); collapsing into a record that is not `Accepted`.

Update the decision index in the same diff: a deleted record leaves the index.

## 4. Rewrite every reference

Search the tracked files for each deleted record's number (`ADR-NNNN`, links to
`docs/adr/NNNN-*.md`) — code comments, documents, configuration. Skip release
history (`CHANGELOG.md`), work state (`.work/`), installed agent assets and
references qualified as another namespace (`shared ADR-NNNN`). Rewrite each one:

- a code comment states the **invariant it protects**, in words;
- a document points to the record's new home, or to the record that absorbed it.

Never leave a bare number to a missing file. When the installed `adr-check` has
the dangling check, `--strict` reports none once the triage PR is ready; otherwise
re-run the search above and find nothing.

## 5. Hand back

Return, in order:

1. **Triage table** — record, status, verdict, evidence, destination, executed or
   awaiting the human. It goes in the triage PR's description, with the reason for
   each executed `Rejected` deletion.
2. **Gate candidates** — rule, evidence it is forgotten, where a check could hold it.
3. **Decisions in force** — a compact, source-linked summary readers load instead
   of the whole corpus; never copy whole records.
4. **Before / after** — records, words, ≈ tokens, for the corpus and for the
   in-force summary. The target size is reported, not enforced.

## The human status boundary

The triage changes no status line. `Accepted`, `Rejected`, `Superseded` and
`Deprecated` are set and committed by a human. If a replacement is chosen, write
only `Proposed` records, following the installed `agent/decision-records.md` or
the repository's format, and state what stays binding until acceptance. Use
`/solution-exploration` to challenge one design choice, and `/architect` for
initial architecture.
