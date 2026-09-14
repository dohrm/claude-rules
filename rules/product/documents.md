---
paths:
  - "docs/**/*.md"
title: "Living Documents — Units and Index"
---

A PRD is **meant to grow** — that is the point of writing it down. What must not
grow is any single file a human has to read to know where the project stands.

So: a document that grows is a **directory of append-only units plus a compacted
index**. Growth adds a unit. It never inflates existing prose. This is the shape
`docs/adr/` already has, and it is the reason a 24-decision log stays usable while
a 900-line PRD does not.

| Document | One unit is | The index is | Split into units at |
|---|---|---|---|
| Decisions | one decision — `docs/adr/NNNN-<slug>.md` | the decision log in `docs/ARCHITECTURE.md` | from the first one |
| Experience | one screen/workflow for one actor — `docs/experience/<journey>-<actor>.md` | `docs/EXPERIENCE.md` | from the first new contract; legacy single-file docs remain valid |
| PRD | one capability — `docs/prd/NN-<slug>.md` | `docs/PRD.md` — the spine + the capability table (with status) | more than ~8 capabilities, or 400 lines |

**Neither the intent nor the plan is on this table.** `/interview`, `/plan` and
`/tasks` write under `.work/<capability-slug>/` — committed (so a PR shows what was
being framed, the sprint breakdown, and the task cut it landed on), but
**ephemeral**: it exists for as long as the
capability is being worked, and is deleted once every sprint under it ships. The
PRD's capability table is what still says "done" afterward — the plan doesn't
need to, because nothing durable reads it once the code and the git log are the
record. One file per capability (`.work/<slug>/PLAN.md`) is enough at this scale;
the unit/index split above exists for documents that must stay readable for the
life of the project, which this one no longer is.

**"Committed" is one gitignore line, and it is not `.work/`.** What sits *directly*
in `.work/` is per-tree scratch — the review report, the review prompt, the status
file — and committing a verdict is how one tree's `CLEAN` ends up authorising
another's push (`agent/autonomy.md`). What sits in `.work/<slug>/` is the plan. So
ignore the files and keep the directories:

```gitignore
# Working memory. A capability's plan and worklists live in .work/<slug>/ and ARE
# committed — a PR shows the cut it landed on. What sits directly in .work/ is
# per-tree scratch: review report, review prompt, status.
.work/*
!.work/*/
```

Allow the directories **by shape, not by name**. A denylist of the scratch files
breaks silently the day the kit adds one — which is how a repo ends up committing
`.work/status` months later and nobody notices.

This composes with a second, nested ignore that `kit/common/diff-since.mjs` writes
and owns: `.work/.gitignore`, carrying `*/.latest_review` and `*/.latest_mutate`,
so the per-developer gate markers stay private *inside* the slug directories this
pattern un-ignores. Two rules, two scopes — don't collapse them into one.

`.work/<slug>/intent.md` is the same deal one step earlier: it carries **what is
still open** while a capability is framed and built. It is not an archive and needs
no successor — what was promised ends up in the PRD, what was decided in an ADR,
and the options that lost are already kept there under *Alternatives considered*
(`agent/decision-records.md`). One directory per capability, born with the intent,
dead when the capability ships.

The framing skills read it — `/prd`, `/plan`, `/pre-mortem`. **An implementer does
not**: a task already carries its own anchors, and an open product question is not
its business — paying for that context on every turn of a loop buys nothing.

**Nor the PRD, nor the decision log** — same argument, one step out. A task cut by
`/tasks` carries `Serves: <acceptance criterion>`, which *is* the PRD projected onto
that task, and `Constrained by: ADR-NNNN § section`, which is `docs/adr/` projected
the same way. Both projections were paid once, at the cut. An implementer that opens
the PRD or walks the decision log is a **worklist that failed to say what bound it** —
fix the cut, not the reading habit.

Below the threshold, one file is right — a directory for three phases is ceremony,
and the split is a mechanical migration, not a decision to agonise over.

The numbers are **defaults, not law**: a repo declares its own once in
`.docs-budgets.json` at the root, and where that file exists it wins over this
table. Read it before writing.

```bash
just docs-check     # index ↔ units (fail); budgets warn unless --strict
```

`docs/adr/` is `just adr-check`. Wiring: `.dev/kit/common/README.md`. The installer
never writes `.docs-budgets.json`. The gate does not see a fact living in two
documents, a shipped unit rewritten to match the code, or an index that answers
the wrong three questions.

Experience units are living contracts (`product/experience.md`), not frozen sprint
history. The developer may revise a retained behavior with its checks. Their
`exploring`/`stable` status and independent visual policy live in the unit, not the
index. `docs-check` validates their fields and references; it cannot establish
human approval, usability or conformance of the running screen.

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
| What is **still undecided**, while this is being framed and built? | the intent (`.work/<slug>/intent.md`, ephemeral) |
| In what order, and what proves a slice is done, **while it's being built**? | the plan (`.work/<slug>/`, ephemeral) |
| Is this capability done, full stop? | the PRD's capability table (status column) |
| What does the system look like — boundaries, stack? | `ARCHITECTURE.md` |
| What are the fields, types, schemas? | `DATA-MODEL.md` |
| What does this actor do — flow, states, recovery, a11y? | `docs/experience/`, indexed by `EXPERIENCE.md` |
| Which toolkit and shared style apply? | `DESIGN.md` |
| What does the project call this, and what should nobody call it instead? | `CONTEXT.md` (`product/vocabulary.md`) |

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
