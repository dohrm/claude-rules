---
title: "Decision Records"
---

An ADR is where a decision stops being an opinion. That transition is the
**human/machine validation boundary**: an agent can research a decision, argue it,
and write it down — it cannot be the thing that declares it settled.

This is the counterpart to `autonomy.md`. There, the agent closes its own loop and
a green gate is authority. Here it does not: a green gate is permission for
**code**, never for a **decision**. The two rules do not conflict; they draw the
line between what a machine may settle and what it may not.

## Statuses

| Status | Meaning | Who may set it |
|--------|---------|----------------|
| `Proposed` | Written and argued, not yet decided. | **Agent or human** |
| `Accepted` | Decided. Binding on the code, cited as settled. | **Human only** |
| `Rejected` | Considered and refused. Kept, because the reasoning is worth keeping. | **Human only** |
| `Superseded by ADR-XXXX` | Replaced by a later decision. | **Human only** |
| `Deprecated` | No longer applies, with nothing replacing it. | **Human only** |

A status may carry a qualifier after the first word — `Accepted — provisional,
review scheduled` — as long as the first word is one of the five.

## The rule

- **An agent writes `Proposed`, and nothing else.** Not `Accepted`, not on the
  strength of its own reasoning, not because the code that goes with it is already
  written and green, not because the human discussed it at length in the
  conversation. Discussing is not accepting, and nothing in the repository
  distinguishes the two afterwards.
- **Say it in the hand-back**: what is proposed, what the alternatives were, and
  what changes if the answer is no. An ADR that lands silently has skipped the
  boundary even if its status line is honest.
- **Amending an accepted ADR's prose is fine** — a consequence learnt in practice,
  an argument that turned out to be wrong, a follow-up. Moving its status line is
  not.
- **Never fake a mandate.** An ADR is a record of a human decision; writing one to
  make a choice already implemented look authorised is the documentation equivalent
  of `--no-verify`.

## Accepting one

The human reads it, changes the status line, and commits that change:

```
- **Status**: Proposed          →      - **Status**: Accepted
```

The commit is what makes the acceptance real — and it is the one signal an agent
does not produce on its own, which is why the gate keys on it.

## The gate

`kit/common/adr-check.mjs`, wired as `just adr-check`, fails when an ADR has no
status or an unknown one, when a **new** ADR carries anything but `Proposed`, and
when the **status line** of an existing ADR differs from the committed version.
Amending prose stays green; so does moving a status *down* to `Proposed`, because
withdrawing a claim is not making one.

Like every gate: it is a file, so it can be edited. It is not a wall. It is there so
that skipping the step has to be a deliberate, visible act rather than an oversight.
