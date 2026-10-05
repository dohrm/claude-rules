---
name: rfc
description: "Frame ONE feature as an iterated RFC — granularity verdict, local decisions, execution steps with proofs, stopping condition — then implement it once the human marks it ready. Stored locally, as a GitHub issue, or as a Plane work item. Use on /rfc, \"write an RFC\", \"build this capability\", \"let's iterate on this feature then build it\". The only path from a framed feature to execution; repeated chores are /loop-setup."
---

You and the human engineer **one feature** in one document, round after round, until
it is ready to build. Then you build it. What earns an ADR instead is `agent/decisions.md` § Which choices need an ADR.

**Autonomy** (`agent/autonomy.md` § Levels): take the level from the argument, else
the RFC's `**Autonomy**` header, else **L1**. Write an explicitly passed level into
that header. Never raise it yourself. The level changes how much you settle without
asking while drafting, and how far you run once the RFC is `ready`. It never lets you
set `ready` yourself.

## Where the RFC lives

Read `> RFC store:` in the header of `docs/ARCHITECTURE.md`. Absent means `local`.
If the project has no answer yet, ask once and write it there.

| Store | The RFC | A round | Status | Who set `ready` |
|---|---|---|---|---|
| `local` | `.work/<slug>/rfc.md` | your revision + a `## Revisions` line | the `**Status**` line | the commit of that line |
| `gh <owner/repo>` | a GitHub issue, via `gh` | an issue comment | label `rfc:<status>` | the issue timeline's actor on `rfc:ready` |
| `plane <workspace/project>` | a Plane work item, via the Plane MCP server | a work-item comment | state group: draft = backlog, ready = unstarted, implementing = started, done = completed | the work item activity's actor on the move |

**`ready` must come from an account other than the one you act as.** Unattended —
CI, a webhook receiver — you act as a service account: read the actor of the
`ready` change and refuse to implement if it is that account. On the human's
workstation you act under their own token, so the actor cannot tell you apart: the
guard is then yours to keep — never set `ready`, even when asked in the chat: the
human moves it.

The template and the rules below are the same in every store; only the medium
changes. Learn the tool from the tool — `gh --help`, the MCP server's tool list —
not from this file. If the declared tool is not available or not authenticated, stop
and say so; never fall back to another store silently.

With `gh` or `plane`, the ticket is the RFC. `.work/<slug>/rfc.md` keeps only the
header (status, autonomy, `**Ticket**: <URL>`) and `## Blocked on the human`, so the
tree's own tools still see it. Mirror the status there whenever it changes. Each
comment or edit on a ticket is a write others can see: keep them to the content of
the RFC. The PR closes the ticket; a closed ticket keeps the local decisions after
the merge.

## Two ways in

- **Attended — the developer's terminal.** The conversation is the round: write
  each point into the RFC as soon as it settles, so the RFC, not the chat, is what
  the work rests on. Input is often dictated: read past transcription slips, ask when
  a term is ambiguous. `/rfc <ticket id or URL>` resumes an existing RFC.
- **Unattended — an event on the ticket** (created, commented, moved), dispatched by a
  webhook receiver or a workflow engine to a headless `claude -p` / `codex exec` in a
  checkout of the repository, so the rules, gates and this skill apply. Each run starts
  from a blank memory: rebuild the state from the RFC and its comments, do the one
  thing the event calls for — verdict and draft, a revision answering new comments,
  or implementation once `ready` — then stop. Needs a `gh` or `plane` store.

Both modes work on the same RFC, under four rules:

- **The RFC is the only state.** Anything not written in it is lost for the next run.
- **One writer.** Whoever starts implementing assigns the ticket to the account it
  acts as and sets `implementing`. Anyone else only reads and comments until it is
  `done` or sent back to `draft`.
- **Keep the request.** The human's original text stays verbatim under `## Request`;
  your revisions go everywhere else.
- **Escalate where the human looks.** On a ticket, `## Blocked on the human` goes into
  the ticket body *and* a comment mentioning the human. A runner's `.work/` is read
  by nobody.

After `ready`, implementation is the same in both modes: a tree, a branch, the steps
in `.work/`, `just check`, `just code-review`, a PR (§ 4).

## 1. Granularity verdict — first, before any draft

Read the request, `CONTEXT.md`, the decision index in `docs/ARCHITECTURE.md`, and
the code the feature touches. Then give one verdict, with its reason:

- **One RFC**: you can state the end proof in a few lines — the command, test or
  observable state that says it is done — and the change fits one reviewable PR.
- **Split into N RFCs**: list them, in order, each with its own one-line proof, under
  `## Sequence` in the first RFC. Draft only the first; each later one starts from
  that list. A PRD capability usually lands here.
- **Not yet an engineering question**: the actor, outcome or scope is still open →
  `/interview`.

At L1, stop on the verdict and wait for agreement. At L2/L3, record it under
`## Assumptions` and continue.

## 2. Draft

Write the RFC from `<rfc-template>`, in the declared store. Ground every step in the code you
read: name the files and symbols it touches, and the proof it leaves behind.

**Local decisions go in the RFC**, each in one line with its reason: a field, a
format, an event, a validation rule, a layout. They are not ADRs. Only a choice that
passes the ADR tests leaves the RFC, as a `Proposed` ADR linked from it, and it blocks
`ready` until the human rules on it. A shared enterprise decision or an Accepted ADR
that the feature would contradict is an open question, not a local decision. A
local decision with impact beyond this project is proposed as a PR on the shared
decision repository (`agent/decisions.md` § Shared decisions), not kept here.

## 3. Iterate

Each round: the human comments, you revise the document, then record what changed —
one line per change under `## Revisions`, or a reply comment on a ticket. Answer a
comment where it was made, not only in the chat.

**Converge, do not wander.** Every round should close more open questions than it
opens. If two consecutive rounds open more than they close, the cut is wrong: say so,
and propose a split or a return to `/interview`. Do not invent questions to look
thorough. A question the code or the rules already answer is not open.

Only the human moves the status to `ready`.

## 4. Implement — only from `ready`

Set `implementing`. Run the steps in order, each closed by its proof, inside the
loop of `agent/autonomy.md`: `just check` green per step, `just code-review` once the
block stands, before the push. Log each step's outcome under `## Log`.

At L1, stop after each step. At L2, stop at the end of the RFC. At L3, run to the
stopping condition; on Codex, start a `/goal` whose stopping condition is the RFC's
and whose state file is `.work/<slug>/rfc.md`. At every level, stop on a hard checkpoint: an ADR status, a new
acceptance criterion, a scope change, a gate bypass. A discovery that changes a local
decision is logged as `changed: <decision> — <why>`. One that changes the scope sends
the RFC back to `draft`.

Set `done` when the stopping condition passes on a fresh run. `.work/<slug>/rfc.md`
is ephemeral: delete it once the PR merges. The PR description keeps the local decisions that
matter. If a `## Sequence` lists a next RFC, name it in the hand-back; the human
starts it.

<rfc-template>
# RFC — <feature in one line>

- **Status**: draft | ready | implementing | done
- **Ticket**: <URL — `gh` and `plane` stores only>
- **Autonomy**: L1 | L2 | L3 — absent means L1
- **Stopping condition**: `<command, test or observable state>`
- **Serves**: <PRD capability / acceptance criterion, if any>
- **Constrained by**: <ADR-NNNN § section, shared decision — only those that bind>

## Request

<the human's original text, verbatim — never rewritten>

## Goal

<the outcome, for whom, in two or three lines>

## Scope

- In: <…>
- Out: <what this RFC must not change>

## Local decisions

- <decision> — <reason>

## Steps

- [ ] <step> — touches `<files/symbols>` → proof: `<command or test>`

## Sequence

<!-- only when the verdict split the work: ordered RFCs, one-line proof each -->

## Open questions

- <question> — <who or what can answer it>

## Assumptions

## Blocked on the human

## Revisions

## Log
</rfc-template>

## Never

- Write an ADR for a local decision, or to justify a deviation from a rule.
- Set `ready` yourself, or start implementing a `draft`.
- Switch stores on your own, or keep a second full copy of a ticket RFC in `.work/`.
- Write to an RFC someone else is implementing, or resume one from memory instead of from the RFC.
- Grow one RFC past one stopping condition instead of splitting it.
- Keep iterating on questions nobody asked to keep the document moving.
