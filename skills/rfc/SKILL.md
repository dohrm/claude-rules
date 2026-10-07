---
name: rfc
description: "Frame ONE feature as an iterated RFC — granularity verdict, local decisions, execution steps with proofs, stopping condition — then implement it once the human marks it ready. Kept in `.work/` (local) or on a ticket (GitHub issue, Plane work item). Use on /rfc, \"write an RFC\", \"build this capability\", \"let's iterate on this feature then build it\", or a ticket event. The only path from a framed feature to execution; repeated chores are /loop-setup."
---

You and the human engineer **one feature** in one document, round after round, until
it is ready to build. Then you build it. What earns an ADR instead is
`agent/decisions.md` § Which choices need an ADR.

**Autonomy** (`agent/autonomy.md` § Levels): take the level from the argument, else
the RFC's `**Autonomy**` header, else **L1**. Write an explicitly passed level into
that header. Never raise it yourself. The level changes how much you settle without
asking while drafting, and how far you run once the RFC is `ready`. It never lets you
set `ready` yourself.

## Where the RFC lives — read your mode first

Read `> RFC store:` in the header of `docs/ARCHITECTURE.md`. Absent means `local`. If
the project has no answer yet, ask once and write it there.

| Store | Mode | Read |
|---|---|---|
| `local` | the RFC is a file in `.work/` that holds its own audit trail | `local.md` |
| `gh <owner/repo>`, `plane <workspace/project>`, another tracker | the RFC is a ticket; its comments and activity are the audit trail | `ticket.md` |

Read the file of your mode before anything else, and only that one. Learn the tool
from the tool — `gh --help`, the MCP server's tool list — not from these files. If the
declared tool is not available or not authenticated, stop and say so; never fall back
to another store silently.

## Two ways in

- **Attended — the developer's terminal.** The conversation is the round: write each
  point into the RFC as soon as it settles, so the RFC, not the chat, is what the work
  rests on. Input is often dictated: read past transcription slips, ask when a term is
  ambiguous. `/rfc <ticket id, URL or slug>` resumes an existing RFC.
- **Unattended — an event on the ticket** (created, commented, moved), dispatched by a
  webhook receiver or a workflow engine to a coding agent (Claude Code, Codex,
  OpenCode) in a checkout of the repository, so the rules, gates and this skill apply.
  Each run starts from a blank memory: rebuild the state from the RFC, do the one thing
  the event calls for — verdict and draft, or a revision answering new comments — then
  stop. Ticket mode only.

**Refining is the default; implementing is asked for.** `/rfc <ticket or slug>` drafts
or runs one refinement round. Implementation starts only on `/rfc implement <ticket or
slug>` — the human asks for it in the terminal, or a dispatcher wired for it calls it —
and only on a `ready` RFC. A ticket event alone, including a move to `ready`, never
starts implementation.

Both ways work on the same RFC, under four rules:

- **The RFC is the only state.** Anything not written in it is lost for the next run.
- **One writer.** Whoever starts implementing takes the RFC (assigns the ticket to the
  account it acts as, or holds the tree) and sets `implementing`. Anyone else only
  reads and comments until it is `done` or sent back to `draft`.
- **Keep the request.** The human's original text stays verbatim under `## Request`;
  your revisions go everywhere else.
- **Escalate where the human looks** — the mode file says where.

**Every write must be attributable — yours or the human's, never ambiguous.** The
record is the audit trail and the next run's context, so it must show who wrote what.

- **Act under your own account** — a bot user or service account for the tracker,
  distinct from the human's token — in both ways in, attended included. Then every
  comment, edit and status change is attributable, and the rule below is checkable.
- **If you only have the human's identity, sign** every comment as the mode file
  says, and never post unsigned. A signature protects the reading, not `ready`.

**`ready` must come from an account other than the one you act as.** Read who set it
(the mode file says where) and refuse to implement if it is your account. Under the
human's identity the record cannot tell you apart: the guard is then yours to keep —
never set `ready`, even when asked in the chat: the human moves it.

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

At L1, stop on the verdict and wait for agreement. At L2/L3, record it as an
assumption (the mode file says where) and continue.

## 2. Draft

Record where the work starts, once, when the RFC is created: `**Repository**` (the
`origin` URL) and `**Base branch**` (`git branch --show-current`). Implementation
branches from it. On a detached HEAD or an unclear base, ask.

Write the RFC from `<rfc-body>`. Ground every step in the code you read: name the
files and symbols it touches, and the proof it leaves behind.

**Local decisions go in the RFC**, each in one line with its reason: a field, a
format, an event, a validation rule, a layout. They are not ADRs. Only a choice that
passes the ADR tests leaves the RFC, as a `Proposed` ADR linked from it, and it blocks
`ready` until the human rules on it. A shared enterprise decision or an Accepted ADR
that the feature would contradict is an open question, not a local decision. A local
decision with impact beyond this project is proposed as a PR on the shared decision
repository (`agent/decisions.md` § Shared decisions), not kept here.

## 3. Iterate

Each round answers the human's comments: revise the RFC, then record the round the way
your mode says.

**Converge, do not wander.** Every round should close more open questions than it
opens. If two consecutive rounds open more than they close, the cut is wrong: say so,
and propose a split or a return to `/interview`. Do not invent questions to look
thorough. A question the code or the rules already answer is not open.

Only the human moves the status to `ready`.

## 4. Implement — only on `/rfc implement`, only from `ready`

Take the RFC (one writer), set `implementing`, and branch from `**Base branch**`. Run
the steps in order, each closed by its proof, inside the loop of `agent/autonomy.md`:
`just check` green per step, `just code-review` once the block stands, before the
push. Record each step's outcome the way your mode says.

At L1, stop after each step. At L2, stop at the end of the RFC. At L3, run to the
stopping condition; on Codex, start a `/goal` whose stopping condition is the RFC's
and whose state file is `.work/<slug>/rfc.md`. At every level, stop on a hard
checkpoint: an ADR status, a new acceptance criterion, a scope change, a gate bypass.
A discovery that changes a local decision is recorded as `changed: <decision> —
<why>`. One that changes the scope sends the RFC back to `draft`.

Set `done` when the stopping condition passes on a fresh run, and open the PR. If a
`## Sequence` lists a next RFC, name it in the hand-back; the human starts it.

<rfc-body>
# RFC — <feature in one line>

- **Status**: draft | ready | implementing | done
- **Autonomy**: L1 | L2 | L3 — absent means L1
- **Repository**: <origin URL>
- **Base branch**: <branch the RFC was started on>
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
</rfc-body>

## Never

- Write an ADR for a local decision, or to justify a deviation from a rule.
- Set `ready` yourself, or start implementing a `draft`.
- Grow one RFC past one stopping condition instead of splitting it.
- Keep iterating on questions nobody asked to keep the document moving.
- Switch stores on your own.
- Write to an RFC someone else is implementing, or resume one from memory instead of
  from the RFC.
