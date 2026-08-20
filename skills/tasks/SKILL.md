---
name: tasks
description: "Turn ONE phase of `docs/PLAN.md` into the worklist an agent loop executes: explore the code once, freeze the contract as code, then cut the phase into tasks sized to the green boundary — each with its anchor in the existing code and its own done-command. Writes `.work/phase-NN-<slug>.md`, working memory that dies with the branch — never a document under `docs/`. Use on /tasks, \"break this phase into tasks\", \"prepare phase N for the loop\", \"make this phase agent-executable\", \"what do I implement first\". Downstream of /plan, upstream of /loop-setup."
---

`/plan` deliberately withholds file names, symbols and layers — a phase is a promise,
and promises must survive the code moving under them. Someone still has to answer
*"this plugs in where?"* before an agent can implement it. **You answer it once, and
write the answer down**, so N implementation turns don't each re-derive it from a cold
context. That amortized exploration is the point of this skill; the task list is only
its shape.

What you produce is **working memory, not truth.** The phase's promise lives in
`docs/plan/NN-*.md` and is frozen once shipped; what actually happened lives in the
`git log`. The worklist is the intention of the moment, rewritable at any turn, and
it is deleted when the branch merges.

## Process

### 1. Get the phase — and refuse it if it isn't ready

Read `docs/PLAN.md` (and `docs/plan/NN-*.md` if split). Take the phase named as an
argument, else the first one not `Shipped`. Read `docs/ARCHITECTURE.md` and the ADRs
it points at — those are constraints on the cut, not suggestions.

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

If a layer has no neighbour, say so — it means the phase introduces a pattern, which
is a design decision and may belong in an ADR before any code.

### 3. Freeze the contract — as code, not prose

Everything the tasks of this phase share goes into **one first task, T0**: types,
migration, OpenAPI/proto spec, trait or interface signatures, error variants, event
shapes. It is committed, it compiles, the gate is green.

The contract is **code**. A contract written in the worklist diverges from the code
at the second commit — the exact failure mode `product/documents.md` exists to
prevent — and generated clients make it worse (`testing/contract.md`: the spec is
the gated artifact). The worklist points at the contract; it never restates it.

T0 is allowed to land stubs and `unimplemented`/`TODO` bodies where a signature
needs one. This is a declared bypass, not a silent one (`agent/autonomy.md`): the
worklist *is* the declaration, and **T0 is never the last commit of the phase**. Say
out loud which stubs it leaves and which task kills each one.

### 4. Cut at the green boundary

> **A task is the smallest change that leaves the gate green.**

Not "about thirty minutes", not "one file". The gate decides, which is what makes
one-commit-per-task true, the branch bisectable, and any task revertable alone.

Apply it mechanically:

- **A task that cannot be green alone is not a task** — merge it into the next one.
  Repeated merging that swallows the whole phase means the phase was cut wrong; back
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

Write `.work/phase-NN-<slug>.md` from `<worklist-template>`, one `<task-unit>` per
task. Add `.work/` to `.gitignore` if it isn't there, and say that you did.

It goes in `.work/` and never in `docs/`, for the same reason a phase is frozen once
shipped: one home per fact (`product/documents.md`). The promise is a document, the
execution is the git history, and this file is neither — it is scaffolding.

`/loop-setup` writes the same skeleton at `.work/loop.md` when there is no phase to
cut. Run against a worklist, it adds its `## Guardrails` section to *this* file and
writes nothing else — one loop, one state file.

### 6. Branch, then hand off

Create `phase/NN-<slug>` off the trunk. One commit per completed task, the task's
title as the subject — the `git log` becomes the phase's real account.

If another session is already working in this checkout, the branch gets **its own
worktree** (`git worktree add ../<repo>-NN-<slug> -b phase/NN-<slug>`): one tree, one
writer. The worklist below and the review verdict both live in `.work/`, which is
per-tree — two sessions sharing a checkout share one verdict (`agent/autonomy.md`).

Then hand off, and stop:

- **`/loop-setup`** — it wraps this worklist in the guardrails you do not own:
  iteration cap, token budget, divergence guard, escalation point.
- **an orchestrator** — pass the worklist as-is. Roles, never model names: a
  *planner* (this skill's output), an *implementer* per task, a *reviewer*. The
  reviewer judges design; **the gate judges correctness** and is the only authority
  on it (`agent/autonomy.md`).

You do not run the loop, and you never flip a phase to `Shipped` — that is the
human's act, on the phase's acceptance criteria, not on ticked boxes.

<worklist-template>
<!-- `.work/phase-NN-<slug>.md`. Working memory: rewritable every turn, deleted at
     merge. Never under docs/. -->
# Phase NN: <title> — worklist

- **Phase**: `docs/plan/NN-<slug>.md` · **Branch**: `phase/NN-<slug>`
- **Gate**: `<the command that must be green — e.g. just check>`
- **Out of scope**: <what this branch must not touch — the drift bound>

## Acceptance criteria (from the phase — the real definition of done)

- [ ] <criterion, verbatim from the phase> → verified by `<command or observation>`

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

- **The worklist is memory, never truth.** It never lands under `docs/`, it is
  gitignored, and it dies with the branch. If something in it deserves to survive,
  it belongs in an ADR or in the phase — move it there, don't promote the file.
- **A task is the smallest change that leaves the gate green.** Everything else about
  granularity follows from that one sentence.
- **The contract is code.** T0 commits it; the worklist points at it.
- **Re-split freely; never widen.** A task that turns out too big is split mid-loop —
  that is the mechanism working. But a *new acceptance criterion* is not a re-split:
  stop, escalate, back to `/plan`. Scope creep dressed as decomposition is the
  failure mode this rule exists to catch (`agent/guardrails.md`).
- **Anchors, not descriptions.** Every task names where it attaches and what to
  imitate. A task an implementer must go explore to understand is a task you did not
  finish writing.
- **Roles, not models.** Planner / implementer / reviewer are roles; who fills them is
  the host's decision and must never be baked into the worklist.
- **The gate is the authority.** A reviewer's approval is a proposal; a green gate is
  permission (`agent/autonomy.md`). Ticking every box is not "phase done" — the
  phase's acceptance criteria being green is.
- **Declare every stub.** T0's stubs are listed with the task that kills each one. An
  undeclared stub at hand-back is the same offence here as anywhere else.
- Plan mode: `.work/*` are read-only planning artifacts — writing them is allowed.
