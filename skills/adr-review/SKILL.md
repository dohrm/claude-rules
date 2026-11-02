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
at 1.35 per word. `adr-check` prints them when the kit is installed; otherwise
count with `wc -w`. They are the "before" column of the final table.

Read every record: explicit status line (`Rejected`, `Rejeté` or `Refusé` where
used; never infer status from a title or a date), decision, successor, references.
Read the shared decision repository named in `docs/ARCHITECTURE.md` (ask for it
if absent; `none` is an answer). Use code, product documents and history
selectively to check whether an apparent conflict or obsolete premise is real;
distinguish evidence from suspicion and mark what still needs verification.

## 2. One verdict per record

Every record gets exactly one verdict from this closed set, with its evidence:

| Verdict | When | Destination |
|---|---|---|
| `keep` | A cross-cutting, hard-to-reverse arbitration that refused real alternatives | stays |
| `move → <home>` | Product, experience, data-shape or vocabulary content | `docs/PRD.md`, `docs/EXPERIENCE.md`, `docs/DATA-MODEL.md`, `CONTEXT.md` or the domain document |
| `gate` | An absolute rule a check or test can hold | a check the project builds; the record may stay as its reason |
| `shared` | Enterprise policy (security, secrets, identity, data protection, deployment) | a PR on the shared decision repository, then a pointer |
| `delete` | Obsolete or `Deprecated`; nothing worth moving | git history |
| `collapse` | Superseded, or `Rejected` while its refusal still prevents a recurring proposal | deleted; the in-force record absorbs the one line it still needs |

The homes are those of `agent/decisions.md` § Which choices need an ADR — invent
none. For `gate`, state the rule in one line and the evidence that it is
forgotten while coding: review reports, review comments, fix commits
(`git log -S`, `git log --grep`). A rule nobody forgets is not a gate candidate.
List gates as candidates; building them is the project's own work. For `shared`,
prepare the shared-repository PR as a `Proposed` record and ask before opening it.

For `collapse`, the in-force record gains at most one line under
`Alternatives considered` — the refused option and the trade-off that killed it.
Collapse only into an `Accepted` record. One `Proposed` record may consolidate
several `keep` records only when they express one coherent decision; choices that
can be accepted independently stay separate.

## 3. Move then delete

Content moves **in the same diff** that removes its record; the human's merge of
that PR is the act. Never delete a record before what it holds worth keeping
exists at its destination.

- **Execute** only deletions whose fate is mechanical: the successor named by
  `Superseded by` is `Accepted` on disk, or the status `Deprecated` or `Rejected`
  was already committed by a human.
- **Propose** every other `delete`, `move` or `collapse` in the triage table and
  execute it once the human answers.
- **Refuse**: deleting a `Proposed` record (a human withdraws it to `Rejected`
  first); deleting a record whose successor is not `Accepted`; collapsing into a
  record that is not `Accepted`.

Update the decision index in the same diff: a deleted record leaves the index.

## 4. Rewrite every reference

Search the tracked files for each deleted record's number (`ADR-NNNN`, links to
`docs/adr/NNNN-*.md`) — code comments, documents, configuration. Skip release
history (`CHANGELOG.md`), work state (`.work/`), installed agent assets and
references qualified as another namespace (`shared ADR-NNNN`). Rewrite each one:

- a code comment states the **invariant it protects**, in words;
- a document points to the record's new home, or to the record that absorbed it.

Never leave a bare number to a missing file. With the kit installed,
`adr-check --strict` reports no dangling reference once the triage PR is ready.

## 5. Hand back

Return, in order:

1. **Triage table** — record, status, verdict, evidence, destination, executed or
   awaiting the human.
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
