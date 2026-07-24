---
name: loop-setup
description: "Frame and write a self-terminating agent loop before running it: check the 4 preconditions, bound the objective, pin a measurable done-command, set budget/iteration guardrails, and produce PLAN.md + MEMORY.md + the ready-to-run loop prompt. Use on /loop-setup, \"set up a loop\", \"automate a repetitive task\", \"run an agent until it's done\", \"loop until the tests pass\", \"make this run autonomously\", \"how do I use /loop\". Helps CADRE a loop for the current host — Claude Code /loop, Codex /goal, or a Cursor automation — it does not replace those commands. Not for one-off tasks."
---

You help build a loop that **stops on proof, not on a feeling**. The whole value is upstream of the loop command: an objective that is bounded, a "done" that a machine decides, and guardrails that keep tokens and drift under control. Simplicity first — an unbounded loop that "wanders until it figures it out" is the expensive failure mode, and you are hostile to it. You do not start the loop; you produce the prompt and the state files, then hand the exact command to run.

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

### 4. Write the artifacts

Create/overwrite in the working dir (extension mode: if a file exists, read it and fill only the deltas — don't clobber validated content):

- `PLAN.md` from `<plan-template>` — the bounded objective + ordered checklist of remaining work (the loop's manager reads this to pick the next item).
- `MEMORY.md` from `<memory-template>` — running log of wins/failures so the loop doesn't repeat a dead end.
- The **loop prompt** from `<loop-prompt-template>` — self-contained and self-terminating.

Confirm *"✓ written PLAN.md, MEMORY.md; loop prompt ready"*.

### 5. Hand off — per host

Emit the invocation for the user's host (ask which if unclear). Same cadre, different launcher:

| Host | Launch | Note |
|------|--------|------|
| **Claude Code** | `/loop <paste the loop prompt>` (omit interval → self-pacing) | the prompt must self-terminate; it does |
| **Codex CLI** (≥ 0.128) | `/goal <objective + done-command + budget>` | Codex plans/tests internally — feed it the bounded objective and the done-command; the budget/cap is what you add |
| **Cursor** | a stop-hook loop (`loop_limit`) or an Automation | heavier: emit the hook config alongside the prompt; `loop_limit` = your iteration cap |

Then state **how to interrupt** the loop and where to watch progress (`PLAN.md` checkboxes, `MEMORY.md` tail).

<plan-template>
# Loop plan — <objective in one line>

**Objective (bounded):** <finite, checkable end state>
**Done-command:** `<command that exits green when the objective is met>`
**Type:** closed | open (missing precondition: <which>)

## Guardrails
- Iteration cap: <N turns>
- Token budget: <budget or "n/a (closed)">
- Escalate when: cap/budget hit, or <M> turns with no measurable progress
- Out of scope (do NOT touch): <bounds that prevent drift>

## Remaining work (manager reads top-down, does the first unchecked)
- [ ] <item 1>
- [ ] <item 2>
- [ ] …
</plan-template>

<memory-template>
# Loop memory

> Append after each turn. Never repeat a recorded dead end.

## Wins
- <turn N>: <what worked>

## Dead ends
- <turn N>: <what failed, and why — so it isn't retried>

## Open questions / for the human
- <blocker that may need escalation>
</memory-template>

<loop-prompt-template>
You are running one turn of a bounded loop toward a fixed objective. Work only from the files below; they are the source of truth, not your memory of prior turns.

**Objective:** <bounded objective>
**Read first:** `PLAN.md` (remaining work + guardrails) and `MEMORY.md` (what already failed).

This turn:
1. Pick the **first unchecked item** in `PLAN.md`. If none remain, go to Done-check.
2. Do exactly that item — nothing outside the "Out of scope" bounds in `PLAN.md`.
3. Run the done-command: `<done-command>`. Read its exit code — do not trust a prior run's claim.
4. Update `PLAN.md` (check the item only if its own check passed) and append one line to `MEMORY.md` (win or dead end).

**Done-check:** if `<done-command>` exits green over the whole objective → state "OBJECTIVE MET", stop the loop, do not start another turn.

**Stop & escalate (never fake green) if:**
- the iteration cap (<N>) or token budget is reached, or
- <M> consecutive turns made no measurable progress toward the done-command, or
- an item needs a decision/access you don't have.
On any of these: stop, write the reason and current state to `MEMORY.md` → "Open questions", and surface it to the human.
</loop-prompt-template>

## Rules

- **"Done" is a green command, never your own say-so** — re-run the done-command and read the exit code each turn (see `rules/agent/autonomy.md` if installed).
- **No loop without a cap and an escalation point.** Exhaustion escalates loudly; it never silently passes or fakes green.
- **The agent is never the authority on "finished"** — the done-command is. An agent's "looks done" is a proposal, not permission.
- **Bound the scope** — the loop touches only what `PLAN.md` lists; no opportunistic refactors, no scope creep (see `rules/agent/guardrails.md` if installed).
- **Refuse the wander** — if the objective can't be made measurable, don't scaffold a loop; say why and stop.
- **State lives in files, not context** — `PLAN.md`/`MEMORY.md` are the memory, so a fresh turn (or a restarted loop) resumes correctly.
- Plan mode: `PLAN.md` and `MEMORY.md` are read-only planning artifacts — writing them is allowed.
