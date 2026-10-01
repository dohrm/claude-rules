---
name: goal-setup
description: "Frame a durable Codex goal: bounded objective, stopping condition, checkpoints, proof and scope. Writes goal.md or a Goal contract on a /tasks worklist. Use on /goal-setup, \"set up a Codex goal\", \"run this as a goal\". Starts it only at autonomy L3. Not for one-off tasks or an unrelated backlog."
---

You prepare a durable Codex `/goal`. A goal is one substantial
objective with a verifiable stopping condition, not a repetition of the same task
and not a loose backlog. It may cross several checkpoints and take hours, provided
its scope and proof remain clear.

**Autonomy** (`agent/autonomy.md` § Levels): take the level from the argument, else
the chosen state file's `**Autonomy**` header, else **L1**. Write an explicitly
passed level into that header before hand-off or launch. Never raise it yourself.

- *L1* — establish and validate the contract with the human before writing the
  state file; present the written result and hand off the launch command.
- *L2* — resolve questions answered by the repo, record each assumption, write the
  state file, then present the contract once for validation and hand off.
- *L3* — resolve and record those questions, write the state file, then start the
  Codex goal if the host offers a goal mechanism. A decision, new acceptance
  criterion, scope change, or gate bypass remains a hard checkpoint at every level.

## 1. Establish the contract

Before writing anything, establish these facts with the user or existing plan:

- **Objective:** one bounded outcome.
- **Stopping condition:** the command, artifact, or observable state that proves it.
- **Scope:** files, modules, constraints, and explicit exclusions.
- **Checkpoints:** the few meaningful intermediate proofs, in order.
- **Escalation:** decisions, access, product changes, or repeated lack of progress
  that require the human rather than another attempt.

At L2/L3, inspect the plan, code and existing checks first. Put each answer taken
without asking under `## Assumptions` in `goal.md`, or as an `assumed:` line in the
worklist's `## Log`. Ask when the evidence cannot settle a material choice.

Do not turn a vague "improve X" or unrelated backlog into a goal. Split it or send
it to `/plan`. A goal without a proof is not ready; help define the smallest useful
test, script, inspection, or acceptance artifact first.

Use `/tasks` when a sprint needs anchors and small independently green changes. A
goal may work from that worklist, but must not create a competing plan.

## 2. Write one state file

Working memory is committed under `.work/<capability-slug>/`, never under `docs/`.

- If `.work/<slug>/tasks/NN-*.md` exists, add only `## Goal contract` to the chosen
  worklist and update its `**Autonomy**` header if explicitly passed. Keep its
  anchors, tasks and acceptance criteria unchanged. The section names the bounded
  objective, one stopping condition, checkpoint proofs, first reading material and
  pause causes; it points at the worklist's existing tasks instead of copying them.
- Otherwise write `.work/<slug>/goal.md` from `<goal-file-template>`.
- If the state file already exists, retain validated facts and update only the
  contract or progress that changed.

At L3, if the objective is an open sprint in `.work/<slug>/PLAN.md` but no task
worklist exists, run `/tasks L3` first and return to this skill with its worklist.
Do not create a parallel `goal.md` for that sprint.

The state file is the source of truth while the goal runs. A human change is made
only while the goal is paused, then recorded as `human: <what and why>` in `## Log`.
If the goal repeatedly needs that intervention, its scope or checkpoint cut is wrong.

<goal-file-template>
<!-- `.work/<slug>/goal.md`: committed working memory while one Codex goal runs.
     A /tasks worklist uses its existing skeleton instead. -->
# Goal — <objective in one line>

- **Objective (bounded)**: <finite outcome>
- **Stopping condition**: `<command, artifact, or observable state>`
- **Autonomy**: L1 | L2 | L3 — absent means L1
- **Out of scope**: <what this goal must not change>

## Checkpoints

- [ ] <checkpoint 1> → verified by `<command or artifact>`
- [ ] <checkpoint 2> → verified by `<command or artifact>`

## Goal contract

- **Read first**: <PLAN/worklist/docs/logs/paths>
- **Progress proof**: <commands or artifacts to inspect at checkpoints>
- **Pause and escalate when**: <decision, access, scope change, or repeated lack of progress>

## Log

<!-- Append a compact entry at each checkpoint or dead end. A human entry records
     a deliberate edit while the goal was paused. -->
- <checkpoint>: <what changed and what was verified>
- human: <what I changed by hand, and why>

## Assumptions

<!-- L2/L3 only: decisions settled without asking, with their evidence. Omit at L1. -->
- <question> → <answer> (<source>)

## Blocked on the human

- <blocker>
</goal-file-template>

## 3. Hand off or launch

At L1/L2, provide a ready-to-paste `/goal` invocation. At L3, start the goal with
the Codex goal mechanism if available; if it is unavailable, provide the same
invocation and say why launch was unavailable. In either case, name the objective,
stopping condition, state file, first reading material, checkpoints, scope,
autonomy level and pause causes.

```text
/goal Complete <objective> at autonomy <L1 | L2 | L3>. Read <state file> and
<materials> first. Work through the checkpoints in order, recording compact
verified progress in the state file.
Do not change <out of scope>. Stop when <stopping condition> is proved. Pause and
report in `## Blocked on the human` if <escalation conditions>. At L2/L3, record
assumptions settled from evidence in `## Assumptions` or the worklist's `## Log`.
```

Tell the user to inspect the current state with `/goal`, and to use `/goal pause`,
`/goal resume`, or `/goal clear` as the work changes. If `just publish-summary` is
wired, it can record a terminal snapshot after completion or escalation.

## Rules

- One goal, one bounded outcome, one state file. Never create a second plan beside
  a `/tasks` worklist.
- Checkpoints are evidence, not ceremonial status updates.
- Do not change code while framing the goal. At L1/L2, hand off the concrete
  command; at L3, launch only after the state file contains the contract.
- Plan mode: writing `.work/*` is allowed.
