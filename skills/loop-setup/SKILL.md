---
name: loop-setup
description: "Frame a self-terminating agent loop: 4 preconditions, bounded objective, measurable done-command, guardrails. Writes `.work/<capability-slug>/loop.md` (or Guardrails on a /tasks worklist) + the loop prompt. Use on /loop-setup, \"set up a loop\", \"loop until the tests pass\". Does not start the loop. Not for one-off tasks."
---

You help build a loop that **stops on proof, not on a feeling**. The whole value is upstream of the loop command: an objective that is bounded, a "done" that a machine decides, and guardrails that keep tokens and drift under control. Simplicity first — an unbounded loop that "wanders until it figures it out" is the expensive failure mode, and you are hostile to it. You do not start the loop; you produce the prompt and the state file, then hand the exact command to run.

## Process

Run these phases in order. Stop at the end of each and wait for validation before the next — a loop set up on a vague objective burns tokens for hours.

### 1. Diagnose — is a loop the right tool?

Walk the **4 preconditions**, one at a time, and get a concrete answer for each:

1. **Repetition** — is the task the same gesture over N targets / N turns? (One-shot work does not need a loop — say so and stop.)
2. **Auto-detectable failure** — can a machine signal tell success from failure, without a human judging?
3. **End-to-end doable** — does the agent have the tools and access to finish every step itself?
4. **"Done" is measured** — is there (or can there be) a command that exits green/red on the whole objective?

Then classify:

- **4/4 → closed loop.** The stop condition *is* the verification. This is the nominal, cheapest case — steer here.
- **< 4/4 → open loop.** You still help, but the missing precondition is **risk #1** — name it. An open loop is only allowed **with a hard token budget + iteration cap + an escalation point** (see phase 3). Never scaffold an unbounded open loop.

### 2. Bound the objective and pin the done-command

- Rewrite the goal as a **bounded** objective: a finite, checkable end state ("all tests green", "every file under `x/` migrated to Y", "no `TODO(loop)` left"), not "improve the code".
- Pin **the done-command** — the single command whose green exit means the whole objective is met. This is the linchpin; without it there is no loop, only wandering. If none exists, help write one (a test, a script, a grep that must return empty) *before* going further.
- If the objective can't be made measurable, stop and say so — that is the signal to *not* loop.

### 3. Set the guardrails

Every loop carries all four:

- **Iteration cap** — max turns before forced stop.
- **Token budget** — an upper bound; mandatory for open loops, recommended for closed.
- **Escalation point** — on cap/budget exhaustion → STOP and surface state to the human, **never** silent failure or fake-green.
- **Divergence guard** — "if N consecutive turns pass with no measurable progress (done-command no closer), STOP and escalate." This is the loop analog of the *three-strikes rule* in `skills/investigate` (if present).

### 4. Write the state file

The loop's state is **one file under `.work/<capability-slug>/`** — working
memory, committed (so a PR shows the cut it's running against), deleted once
the capability ships. Not a document, and never under `docs/`.

**First, look for a file that already exists:**

- **`.work/<slug>/tasks/NN-*.md` — a worklist from `/tasks`.** Then the plan is already written, with anchors and tasks cut at the green boundary. **Do not create a second file.** Read it, and add only what you own: the `## Guardrails` section from phase 3. Everything else is `/tasks`' and stays untouched.
- **Nothing there** — write `.work/<slug>/loop.md` from `<loop-file-template>`.
- **A file exists from an earlier run** — read it and fill only the deltas; don't clobber validated content.

Build the **loop prompt** from `<loop-prompt-template>`, pointing at whichever file you settled on.

Confirm *"✓ `.work/<slug>/<file>` written (guardrails added); loop prompt ready"*.

### 5. Hand off — per host

Emit the invocation for the user's host (ask which if unclear). Same cadre, different launcher:

| Host | Launch | Note |
|------|--------|------|
| **Claude Code** | `/loop <paste the loop prompt>` (omit interval → self-pacing) | the prompt must self-terminate; it does |
| **Codex CLI** (≥ 0.128) | `/goal <objective + done-command + budget>` | Codex plans/tests internally — feed it the bounded objective and the done-command; the budget/cap is what you add |
| **Cursor** | a stop-hook loop (`loop_limit`) or an Automation | heavier: emit the hook config alongside the prompt; `loop_limit` = your iteration cap |

Then state **how to interrupt** the loop and where to watch progress (the state file's checkboxes and its `## Log` tail).

<loop-file-template>
<!-- `.work/<slug>/loop.md`. Working memory: rewritten every turn, committed,
     deleted when the capability ships. Never under docs/. A sprint worklist from
     /tasks has this same skeleton, plus its anchors — in that case add the
     Guardrails section there instead of creating this file. -->
# Loop — <objective in one line>

- **Objective (bounded)**: <finite, checkable end state>
- **Done-command**: `<command that exits green when the objective is met>`
- **Type**: closed | open (missing precondition: <which>)

## Guardrails

- **Iteration cap**: <N turns>
- **Token budget**: <budget, or "n/a (closed)">
- **Escalate when**: cap/budget hit, or <M> turns with no measurable progress
- **Out of scope**: <bounds that prevent drift — the loop touches nothing else>

## Remaining work

<!-- The manager reads top-down and does the first unchecked item. -->
- [ ] <item 1>
- [ ] <item 2>

## Log

<!-- One line per turn, appended: what landed, or what failed and why. Never retry a
     recorded dead end. -->
- <turn>: <win or dead end>

## Blocked on the human

<!-- Anything the loop cannot decide or access. Non-empty here means the loop
     stopped and is waiting — it never means "carry on anyway". -->
- <blocker>
</loop-file-template>

<loop-prompt-template>
You are running one turn of a bounded loop toward a fixed objective. Work only from the state file below; it is the source of truth, not your memory of prior turns.

**Objective:** <bounded objective>
**State file:** `<.work/<slug>/loop.md or .work/<slug>/tasks/NN-slug.md>` — remaining work, guardrails, and what already failed.

This turn:
1. Read the state file. Pick the **first unchecked item**. If none remain, go to Done-check.
2. Do exactly that item — nothing outside its "Out of scope" bounds.
3. Run the done-command: `<done-command>`. Read its exit code — do not trust a prior run's claim.
4. Update the state file: check the item only if its own check passed, and append one line to `## Log` (win or dead end).

**Done-check:** if `<done-command>` exits green over the whole objective → state "OBJECTIVE MET", stop the loop, do not start another turn.

**Stop & escalate (never fake green) if:**
- the iteration cap (<N>) or token budget is reached, or
- <M> consecutive turns made no measurable progress toward the done-command, or
- an item needs a decision, an access, or a scope change you don't have.

On any of these: stop, write the reason and current state under `## Blocked on the human`, and surface it.
</loop-prompt-template>

## Rules

- Done is a green command (`agent/autonomy.md`). No loop without a cap and an escalation point.
- One state file under `.work/<slug>/`. Never a second plan next to a `/tasks` worklist — add Guardrails there.
- Plan mode: writing `.work/*` is allowed.
