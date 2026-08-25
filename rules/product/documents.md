---
paths:
  - "docs/**/*.md"
title: "Living Documents — Units and Index"
---

A PRD and a PLAN are **meant to grow** — that is the point of writing them down.
What must not grow is any single file a human has to read to know where the project
stands.

So: a document that grows is a **directory of append-only units plus a compacted
index**. Growth adds a unit. It never inflates existing prose. This is the shape
`docs/adr/` already has, and it is the reason a 24-decision log stays usable while
a 900-line plan does not.

| Document | One unit is | The index is | Split into units at |
|---|---|---|---|
| Decisions | one decision — `docs/adr/NNNN-<slug>.md` | the decision log in `docs/ARCHITECTURE.md` | from the first one |
| Plan | one phase — `docs/plan/NN-<slug>.md` | `docs/PLAN.md` — the phase table | more than ~6 phases, or 400 lines |
| PRD | one capability — `docs/prd/NN-<slug>.md` | `docs/PRD.md` — the spine + the capability table | more than ~8 capabilities, or 400 lines |

Below the threshold, one file is right — a directory for three phases is ceremony.
The split is a mechanical migration when the threshold arrives, not a decision to
agonise over.

The numbers here are **defaults, not law**. A repo whose document legitimately needs
a different budget declares it once in `.docs-budgets.json` at its root. Read that
file before writing: where it exists, it wins over this table.

```bash
just docs-check     # index ↔ units (fail); budgets warn unless --strict
```

`docs/adr/` is `just adr-check`. Wiring: `.dev/kit/common/README.md`. The installer
never writes `.docs-budgets.json`. The gate does not see a fact living in two
documents, a shipped unit rewritten to match the code, or an index that answers
the wrong three questions.

## The unit

- **One unit, one thing** — one decision, one phase, one capability. If it needs
  the word "and" in its title, it is two.
- **Budgeted.** A phase or a capability is ~400–500 words; an ADR is ~400 (600
  ceiling — `agent/decision-records.md`). Over budget means it is two units, or it
  holds a description that belongs elsewhere (below).
- **Carries its own status** on the first lines: `Planned` / `In progress` /
  `Shipped <date>` for a phase, the ADR statuses for a decision.
- **Frozen once shipped.** A shipped phase is a record of what was promised, not a
  live document. It is never rewritten to match what was actually built — what
  actually happened goes in the ADR's `Implemented` section, or in the next unit.
  A plan quietly edited to match the code has stopped being a plan.

## The index

The index is the **compaction**, not a table of contents. It must be readable on
its own and answer exactly three questions: **where are we, what is next, what is
out**. One line per unit, and a hard budget of one screen — `indexCeiling`, which a
repo may set per document when its index genuinely needs more
(`.docs-budgets.json`).

- It carries only what is needed to navigate and to know status. **Never a fact
  that would have to be updated when a unit changes** — that fact has one home, and
  it is the unit.
- It is rewritten in full on every update (unlike the units, which are appended).
- If the index outgrows its screen, the units are too fine-grained, or the project
  needs a level above them (epics, milestones) — not a longer index.

## One home per fact

Duplication is how these documents drift apart. A fact belongs to exactly one
document:

| The question | The home |
|---|---|
| What are we building, and why does anyone care? | the PRD |
| Why *this* choice, and what did it cost? | an ADR |
| In what order, and what proves a slice is done? | the plan |
| What does the system look like — boundaries, stack? | `ARCHITECTURE.md` |
| What are the fields, types, schemas? | `DATA-MODEL.md` |
| What does the screen do — states, wording, a11y? | `EXPERIENCE.md` |

A PRD that names a library, a plan that restates an ADR's reasoning, or an ADR that
lists fields are all the same mistake: two homes for one fact, and the copy is the
one that goes stale.

## Growing without inflating

- **New scope is a new unit.** Not a new paragraph in an existing section, and never
  a `### … (continued)` heading — that heading is the symptom this rule exists to
  prevent.
- **Editing a unit is for correcting it**, not for accumulating in it.
- **A stale unit is deleted or superseded**, never left to be contradicted by a
  later one. Say which unit supersedes it.
- **The reader decides the size, not the writer.** A document nobody finishes is a
  document nobody acted on, and unread scope is the same as unwritten scope.
