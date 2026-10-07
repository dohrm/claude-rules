# RFC — ticket mode

The RFC is **a ticket**. Its **body is the current state**, rewritten every round.
Its **comments and activity history are the audit trail** — the ticket system keeps
them, so the body never carries history.

- Never write history into the body: no revision list, no log, no "previously".
- Never leave state only in a comment: a point settled in a comment exists once it
  is folded into the body. The next run reads the body first.

## Per tool

| Store | The RFC | Act as | A round | Status | Who set `ready` |
|---|---|---|---|---|---|
| `gh <owner/repo>` | a GitHub issue, via `gh` | a bot account or GitHub App token (`GH_TOKEN`), not the human's login | a comment | label `rfc:<status>` | the issue timeline's actor on `rfc:ready` |
| `plane <workspace/project>` | a Plane work item, via the Plane MCP server | a bot member (e.g. `rfc-agent`) whose API key the MCP server uses, not the human's key | a comment | state group: draft = backlog, ready = unstarted, implementing = started, done = completed | the activity's actor on the state change |

Another tracker follows the same mapping once it offers a body, comments, a status
and an activity history.

Check which account the tool acts as before the first write (`gh api user`, the MCP
server's current-user call). If it is the human's, you are in the signed fallback.

## The body

Exactly `<rfc-body>` from `SKILL.md`, in the tracker's format, plus — only while it
holds — a `## Blocked on the human` section.

## A round

1. **Rebuild the context.** Read the body, then the comments since your last one —
   yours are those from your account, or starting with the 🤖 line.
   When that is not enough — an unexplained change, a reference to an earlier
   exchange — read the older comments and the activity history. Never resume from
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

`.work/<slug>/rfc.md` is only a pointer, so the tree's tools still see the RFC: the
header lines `Status`, `Autonomy`, `Repository`, `Base branch`, plus
`**Ticket**: <URL>`, and `## Blocked on the human` while blocked. Mirror the status
whenever it changes. Never copy the body there.

## `ready` and escalation

- Read who set `ready` in the activity history (table above), then apply `SKILL.md`'s
  account rule.
- Escalate in two places: a `## Blocked on the human` section in the body, and a
  comment mentioning the human. Remove the section once unblocked. A runner's `.work/`
  is read by nobody.

## Writes are visible

Every edit and comment is published to everyone who can see the ticket. Keep them to
the RFC's content: no secrets, no dumps of logs or code beyond what the round needs.
