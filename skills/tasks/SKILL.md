---
name: tasks
description: "Cut ONE sprint of `.work/<capability-slug>/PLAN.md` into tasks sized to the green boundary, with anchors in the existing code. Writes `.work/<capability-slug>/tasks/NN-<sprint-slug>.md` (committed, dies with the capability). Use on /tasks, \"break this sprint into tasks\", \"prepare sprint N for the loop\". Downstream of /plan, upstream of /loop-setup."
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

Both are cheap to say now and expensive to discover at task 6.

### 2. Explore the code once — produce anchors, not descriptions

This is the expensive step and the one being amortized. Walk every layer the slice
traverses (schema, domain, transport, UI, tests). For each, record:

- **the anchor** — the module, file, type or route the work attaches to, by name;
- **the nearest neighbour** — the closest thing that already does something similar
  and should be imitated. *This is the single most useful line you can hand a fresh
  implementer*: the conventions of the repo are in that file, not in your prose.

If a layer has no neighbour, say so — it means the sprint introduces a pattern, which
is a design decision and may belong in an ADR before any code.

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

Present the cut to the user — numbered, one line each, with its done-command — and
ask whether the granularity holds before writing anything.

### 5. Write the worklist

Write `.work/<slug>/tasks/NN-<sprint-slug>.md` from `<worklist-template>`, one
`<task-unit>` per task — `NN` is the sprint's number in `.work/<slug>/PLAN.md`.
Commit it: this is working memory, but it is **committed** working memory, so a
PR can point at the cut it landed on, and `.work/<slug>/` disappears in one piece
once the whole capability ships, not file by file as each sprint lands.

It never goes in `docs/`, for the same reason a sprint is frozen once shipped:
one home per fact (`product/documents.md`). The promise is `.work/<slug>/PLAN.md`,
the execution is the git history, and this file is neither — it is scaffolding.

`/loop-setup` writes the same skeleton at `.work/<slug>/loop.md` when there is no
sprint to cut. Run against a worklist, it adds its `## Guardrails` section to
*this* file and writes nothing else — one loop, one state file.

### 6. Branch, then hand off

Create `sprint/<slug>-NN` off the trunk. One commit per completed task, the task's
title as the subject — the `git log` becomes the sprint's real account.

If another session is already working in this checkout, the branch gets **its own
worktree** (`git worktree add ../<repo>-<slug>-NN -b sprint/<slug>-NN`): one tree, one
writer. The worklist below and the review verdict both live in `.work/`, which is
per-tree — two sessions sharing a checkout share one verdict (`agent/autonomy.md`).

Then hand off, and stop:

- **`/loop-setup`** — it wraps this worklist in the guardrails you do not own:
  iteration cap, token budget, divergence guard, escalation point.
- **an orchestrator** — pass the worklist as-is. Roles, never model names: a
  *planner* (this skill's output), an *implementer* per task, a *reviewer*. The
  reviewer judges design; **the gate judges correctness** and is the only authority
  on it (`agent/autonomy.md`).

You do not run the loop, and you never flip a sprint to `Shipped` — that is the
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
- **Out of scope**: <what this branch must not touch — the drift bound>

## Acceptance criteria (from the sprint — the real definition of done)

- [ ] <criterion, verbatim from the sprint> → verified by `<command or observation>`

## Anchors

| Layer | Attaches to | Nearest neighbour to imitate |
|---|---|---|
| <schema/domain/transport/ui/test> | `<module or symbol>` | `<path:symbol>` |

## Tasks

- [ ] **T0 — freeze the contract** · leaves stubs: <list, or none>
- [ ] **T1 — <title>**
- [ ] …

## Log

<!-- One line per turn, appended: what landed, or what failed and why. Never retry a
     recorded dead end. -->
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
- **Consumes**: T0's `<contract element>` <, TN-1's …>
- **Serves**: <the acceptance criterion this moves>
- **Done**: `<command that exits green — the gate, or a narrower test first>`

<Two or three lines: what becomes true. No code, no diff — the implementer reads the
neighbour for the how.>
</task-unit>

## Rules

- **Re-split freely; never widen.** A too-big task splits mid-loop. A *new acceptance criterion* is not a re-split: stop, back to `/plan`.
- **`.work/<slug>/` is committed, not gitignored** — a PR shows the cut, not just the diff. It is still ephemeral: deleted once the capability ships, never a durable document.
- **Roles, not models.** Planner / implementer / reviewer are roles; never bake a model name into the worklist.
- Plan mode: writing `.work/*` is allowed.
