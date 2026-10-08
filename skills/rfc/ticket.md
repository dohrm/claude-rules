# RFC — ticket mode

The RFC is **a ticket**. Its **body is the current state**, rewritten every round.
Its **comments and activity history are the audit trail** — the tracker keeps them,
so the body never carries history.

- Never write history into the body: no revision list, no log, no "previously".
- Never leave state only in a comment: a point settled in a comment exists once it
  is folded into the body. The next run reads the body first.

## The tracker contract

This skill names no tracker. It needs seven operations, and any tracker that offers
them works:

| Operation | Used for |
|---|---|
| **whoami** — the account you act as | attribution, the `ready` rule |
| **read** — body, status, assignee | every round |
| **comments** — with author and date | rebuilding the context |
| **write body** | revising the RFC |
| **comment** | the audit trail |
| **set status, assign** | implementation |
| **status history** — who changed the status | checking who set `ready` |

**The project's adapter says how.** `docs/ARCHITECTURE.md` carries a `## RFC store`
section, written by `/architect`:

```markdown
## RFC store
- Tracker: <tool>, <project or repository>
- Access: <CLI command> — else <REST base URL>, token in `$<VAR>`
- Act as: <bot account>
- Status: draft = <…>, ready = <…>, implementing = <…>, done = <…>
- Who set ready: <where the status history names the actor>
```

Example, a GitHub issue: access `gh`, token in `$GH_TOKEN`; status labels
`rfc:<status>`; who set ready = the issue timeline's actor on `rfc:ready`.

**Access, in this order of preference:**

1. **A CLI** (`gh`, `glab`, `tea`, …): fast, scriptable, the same under every agent.
2. **The REST API** with `curl` and the token from the declared variable.
3. **An MCP server**, only when nothing else exists: it loads many tools into the
   context, is slow, and must be configured in every runner.

Learn the commands from the tool (`--help`, the API reference), not from memory. If
the section is missing, ask once and write it. If the declared access fails, stop and
say so; never fall back to another tracker or store.

Check **whoami** before the first write. If it is the human's account, you are in
`SKILL.md`'s signed fallback.

## Pre-fetched context

A dispatcher that already received the ticket through its webhooks may hand it to
you instead of letting you fetch it: a file named in the invocation (by default
`.work/<slug>/ticket-context.md`) holding any of the read operations — body, status,
assignee, the comments since your last round, the event's author, who set `ready`,
the account you act as.

- **Trust it.** It was collected outside the model, deterministically: do not fetch
  again to verify it. Who set `ready`, given there, is the record.
- **Fetch only what it lacks.**
- **Writes still go through the adapter** — body, comment, status.

## The body

Exactly `<rfc-body>` from `SKILL.md`, in the tracker's format, plus — only while it
holds — a `## Blocked on the human` section.

## A round

1. **Rebuild the context.** Read the body, then the comments since your last one —
   yours are those from your account, or starting with the 🤖 line.
   When that is not enough — an unexplained change, a reference to an earlier
   exchange — read the older comments and the status history. Never resume from
   memory.
2. **Revise the body** with every change the comments call for.
3. **Post one comment** saying what you did:

   ```markdown
   🤖 **RFC round N** — <agent>[ on behalf of <user>]
   - Changed: <what changed in the body, one line each>
   - Answered: <comment> → <answer, or where the body now answers it>
   - Assumed: <question settled without asking — the answer taken, and why>
   - Open: <what still needs the human>
   ```

One round, one comment. Do not reply piecemeal to each comment.

**Every comment you post starts with the 🤖 line** — rounds, step outcomes,
escalations. Under the human's identity, `on behalf of <user>` is mandatory, and a
comment without it is never posted: it would read as the human's own words, and the
next run would take it as their decision.

## Implementation

Take the ticket: assign it to the account you act as, set `implementing`. Tick each
step in the body as its proof passes, and post one comment per finished step
(outcome, proof result, `changed: …` when a local decision moved). The PR references
the ticket and closes it on merge; the closed ticket keeps the decisions afterwards.

Phases may be mirrored as sub-tickets when the tracker has them, for the board only:
each holds a link to the RFC and its phase's PR, never state. The parent body stays
the RFC, and a sub-ticket event is an event on the RFC.

`.work/<slug>/rfc.md` is only a pointer, so the tree's tools still see the RFC: the
header lines `Status`, `Autonomy`, `Repository`, `Base branch`, plus
`**Ticket**: <URL>`, and `## Blocked on the human` while blocked. Mirror the status
whenever it changes. Never copy the body there.

## `ready` and escalation

- Take who set `ready` from the pre-fetched context, else from the status history,
  then apply `SKILL.md`'s account rule.
- Escalate in two places: a `## Blocked on the human` section in the body, and a
  comment mentioning the human. Remove the section once unblocked. A runner's `.work/`
  is read by nobody.

## Writes are visible

Every edit and comment is published to everyone who can see the ticket. Keep them to
the RFC's content: no secrets, no dumps of logs or code beyond what the round needs.
