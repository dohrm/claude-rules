---
name: tasks
description: "Cut ONE sprint of a capability's PLAN.md into tasks sized to the green boundary, anchored in the existing code. Writes a sprint worklist under .work/. Use on /tasks, \"break this sprint into tasks\", \"prepare sprint N for the loop\". Between /plan and /loop-setup."
---

`/plan` deliberately withholds file names, symbols and layers — a sprint is a promise,
and promises must survive the code moving under them. Someone still has to answer
*"this plugs in where?"* before an agent can implement it. **You answer it once, and
write the answer down**, so N implementation turns don't each re-derive it from a cold
context. That amortized exploration is the point of this skill; the task list is only
its shape.

What you produce is **working memory, not truth.** The sprint's promise lives in
`.work/<slug>/PLAN.md` and is frozen once shipped; what actually happened lives in the
`git log`. The worklist is the intention of the moment, rewritable at any turn, and
it is deleted once the capability it belongs to ships (`product/documents.md`) —
committed until then, so a PR can point at it, not gitignored scratch.

**Autonomy** (`agent/autonomy.md` § Levels): take the level from the argument, else
from the `.work/<slug>/PLAN.md` header, else **L1**. It changes the checkpoints and
the depth of the worklist marked *L1 / L2 / L3* below — never the refusals of step 1,
T0, or the green boundary.

## Process

### 1. Get the sprint — and refuse it if it isn't ready

Read `.work/<slug>/PLAN.md`. Take the sprint named as an argument, else the first
one not `Shipped`. Read `docs/ARCHITECTURE.md` and the ADRs it points at — those
are constraints on the cut, not suggestions.

Stop and hand back, rather than cutting, when:

- **an acceptance criterion is not observable** — no event, output, or measure a
  machine can check. Send it back to `/plan`; a criterion nobody can verify makes
  every task under it unfalsifiable.
- **the repo has no gate** — no `just check`, no `lefthook`, nothing that exits
  green/red on the whole tree. Then the green boundary of step 4 does not exist and
  there is nothing to size tasks against. Set the gate up first (`kit/common`).

Both are cheap to say now and expensive to discover at task 6 — and both hold at
every level: autonomy without a gate is not autonomy, it is an unchecked guess.

### 2. Explore the code once — produce anchors, not descriptions

This is the expensive step and the one being amortized. Walk every layer the slice
traverses (schema, domain, transport, UI, tests). For each, record:

- **the anchor** — the module, file, type or route the work attaches to, by name;
- **the nearest neighbour** — the closest thing that already does something similar
  and should be imitated. *This is the single most useful line you can hand a fresh
  implementer*: the conventions of the repo are in that file, not in your prose.
- **the constraint that binds it** — the `Accepted` ADR deciding something about
  this layer, by number and section (`ADR-NNNN § Decision+Consequences`). A
  pointer, never a summary: the ADR is the home of that fact.

Constraints amortize exactly like anchors, and they are the ones that get skipped —
step 1 already made you read `docs/ARCHITECTURE.md` and its ADRs to cut the sprint,
so write down which ones you actually used. An implementer handed no constraint
reads the whole `docs/adr/` directory to be safe, or reads none of it and finds out
in review. Skip `Context` and `Implemented` when you point: they serve the reader of
the decision, not its implementer.

If a layer has no neighbour, say so. A new pattern needs an ADR only when it
changes a durable architectural constraint (`agent/decisions.md`); a local
implementation choice does not need one merely because it is new.

For UI work, read `docs/EXPERIENCE.md` and only the contracts for affected journeys
and actor profiles. Record their links, status, visual policy and applicable
property names under **Experience** in each task; do not copy the contracts. Legacy
single-file requirements remain applicable. Distinguish tests of stable behavior
from experiments: a task may explore layout without freezing it in snapshots.
Contract status never relaxes API, security or existing behavioral checks.

### 3. Freeze the contract — as code, not prose

Everything the tasks of this sprint share goes into **one first task, T0**: types,
migration, OpenAPI/proto spec, trait or interface signatures, error variants, event
shapes. It is committed, it compiles, the gate is green.

The contract is **code**. A contract written in the worklist diverges from the code
at the second commit — the exact failure mode `product/documents.md` exists to
prevent — and generated clients make it worse (`testing/contract.md`: the spec is
the gated artifact). The worklist points at the contract; it never restates it.

T0 is allowed to land stubs and `unimplemented`/`TODO` bodies where a signature
needs one. This is a declared bypass, not a silent one (`agent/autonomy.md`): the
worklist *is* the declaration, and **T0 is never the last commit of the sprint**. Say
out loud which stubs it leaves and which task kills each one.

### 4. Cut at the green boundary

> **A task is the smallest change that leaves the gate green.**

Not "about thirty minutes", not "one file". The gate decides, which is what makes
one-commit-per-task true, the branch bisectable, and any task revertable alone.

Apply it mechanically:

- **A task that cannot be green alone is not a task** — merge it into the next one.
  Repeated merging that swallows the whole sprint means the sprint was cut wrong; back
  to `/plan`.
- **A task that is green but makes nothing new true is not a task either** — it is
  part of another one.
- **Order by contract, not by layer.** A task may consume only what T0 froze or what
  an earlier task produced. Two tasks that need each other are one task.
- A task stays in **one anchor's neighbourhood**. Spanning three anchors is the
  reliable signal that it is really three tasks.

- *L1* — present the cut to the user — numbered, one line each, with its
  done-command — and ask whether the granularity holds before writing anything.
- *L2* — write the worklist, then present the cut once and apply the corrections.
- *L3* — write it and hand off. The cut is rewritable at any turn; a task that turns
  out to need a new acceptance criterion is the hard checkpoint, not the cut itself.

### 5. Write the worklist

Write `.work/<slug>/tasks/NN-<sprint-slug>.md` from `<worklist-template>`, at the
depth the level sets below — `NN` is the sprint's number in `.work/<slug>/PLAN.md`.

The depth follows the implementer, because the task units exist to spare a cold
context from re-deriving the anchors:

- *L1* — one `<task-unit>` per task.
- *L2 / L3* — the Anchors table carries the exploration; each checkbox line, T0
  included, takes the template's L2/L3 form (`· Done: … · Constrained by: …`).
  Write a `<task-unit>` only for a task whose anchor, experience contract or
  consumed contract element the table does not make obvious.

Commit it, and never put it under `docs/`: **`.work/<slug>/` is committed working
memory — one home per fact, deleted in one piece once the whole capability ships,
not file by file as each sprint lands** (budgets and freeze-on-ship:
`product/documents.md`). The promise is `.work/<slug>/PLAN.md`, the execution is the
git history, and this file is neither — it is scaffolding.

`/loop-setup` writes the same skeleton at `.work/<slug>/loop.md` when there is no
sprint to cut. Run against a worklist, it adds its `## Guardrails` section to
*this* file and writes nothing else — one loop, one state file.

### 6. Branch, then hand off

Create `sprint/<slug>-NN` off the trunk. One commit per completed task, the task's
title as the subject — the `git log` becomes the sprint's real account.

If another session is already working in this checkout, the work moves to **the
capability's worktree** — `just tree <slug>`, which prints its path — and the
sprint branch is created *inside* it. One tree per capability, one branch per
sprint: `.work/<slug>/` is per-tree and holds this capability's plan and every one
of its worklists, so a tree per sprint would split one work unit across trees
(`agent/autonomy.md`). Parallel work belongs between capabilities, not between the
sprints of one — two vertical slices of the same capability traverse the same
layers.

Then hand off — and stop, unless this is an L3 chain (below):

- **`/loop-setup`** — it wraps this worklist in the guardrails you do not own:
  iteration cap, token budget, divergence guard, escalation point.
- **an orchestrator** — pass the worklist as-is. Roles, never model names: a
  *planner* (this skill's output), an *implementer* per task, a *reviewer*. The
  reviewer judges design; **the gate judges correctness** and is the only authority
  on it (`agent/autonomy.md`).

At *L3*, `/plan` or `/loop-setup` may run this skill themselves when the human asked
for the chain — the output is the same file, written before any code, so the cut
stays reviewable and the loop resumable. Reached from `/plan`, do not stop at the
hand-off: run `/loop-setup L3` on this worklist. Reached from `/loop-setup`, return to it.

You do not run the loop yourself — at L3, `/loop-setup` does — and you never flip a sprint to `Shipped` — that is the
human's act, on the sprint's acceptance criteria, not on ticked boxes. When the
merge that ships the sprint lands, delete its `tasks/NN-*.md` in the same commit;
once every sprint under the capability is gone, delete `.work/<slug>/` entirely
and re-run `/prd` (`product/documents.md`).

<worklist-template>
<!-- `.work/<slug>/tasks/NN-<sprint-slug>.md`. Working memory: rewritable every
     turn, deleted at merge. Committed until then. Never under docs/. -->
# Sprint NN: <title> — worklist

- **Sprint**: `.work/<slug>/PLAN.md` § Sprint NN · **Branch**: `sprint/<slug>-NN`
- **Gate**: `<the command that must be green — e.g. just check>`
- **Autonomy**: L1 | L2 | L3 — absent means L1
- **Out of scope**: <what this branch must not touch — the drift bound>

## Acceptance criteria (from the sprint — the real definition of done)

- [ ] <criterion, verbatim from the sprint> → verified by `<command that exits green>`

## Anchors

| Layer | Attaches to | Nearest neighbour to imitate |
|---|---|---|
| <schema/domain/transport/ui/test> | `<module or symbol>` | `<path:symbol>` |

## Tasks

<!-- L1: bare lines, one `<task-unit>` per task below them.
     L2/L3: every line carries its done-command and its constraint — task units
     are the exception, so these two fields cannot live only there. -->
- [ ] **T0 — freeze the contract** · leaves stubs: <list, or none>
- [ ] **T1 — <title>**
- [ ] …

<!-- L2/L3 form of the same lines: -->
- [ ] **T0 — freeze the contract** · leaves stubs: <list, or none> · Done: `<cmd>` · Constrained by: <ADR-NNNN § section | none>
- [ ] **T1 — <title>** · Done: `<cmd>` · Constrained by: <ADR-NNNN § section | none>

## Log

<!-- One line per turn, appended: what landed, or what failed and why. Never retry a
     recorded dead end. At L2/L3, a question settled without asking is logged too,
     as `assumed: <question> → <answer>`. -->
- <turn>: <win or dead end>

## Blocked on the human

<!-- What the loop cannot decide or access — a new acceptance criterion above all.
     Non-empty means the loop stopped and is waiting. This section IS the escalation
     channel: `just status` surfaces it across every worktree, so a stop written here is
     findable without reopening the session. One line per blocker, no placeholders. -->
- <blocker>

<!-- `/loop-setup` adds a `## Guardrails` section here (iteration cap, token budget,
     divergence guard). It does not own anything else in this file. -->
</worklist-template>

<task-unit>
<!-- One per task, under `## Tasks`, below the checkbox list once the cut is agreed. -->
### TN — <title>

- **Anchor**: `<module or symbol>` · **Neighbour**: `<path:symbol>`
- **Constrained by**: `<ADR-NNNN § section>` — or `none`, never blank
- **Experience**: <contract link · actor · status · visual policy · properties, or none>
- **Consumes**: T0's `<contract element>` <, TN-1's …>
- **Serves**: <the acceptance criterion this moves>
- **Done**: `<command that exits green — the gate, or a narrower test first>`

<Two or three lines: what becomes true. No code, no diff — the implementer reads the
neighbour for the how.>
</task-unit>

## Rules

- **Re-split freely; never widen.** A too-big task splits mid-loop. A *new acceptance criterion* is not a re-split: stop, back to `/plan`.
- **`.work/<slug>/` is committed, not gitignored** — a PR shows the cut, not just the diff. It is still ephemeral: deleted once the capability ships, never a durable document.
- **Name constraints, never restate them.** `none` is an answer; an empty
  **Constrained by** is a gap an implementer cannot tell from a green light.
- **Roles, not models.** Planner / implementer / reviewer are roles; never bake a model name into the worklist.
- Plan mode: writing `.work/*` is allowed.
