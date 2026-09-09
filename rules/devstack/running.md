---
title: "Running the App Locally"
---

An agent that needs the app running has three ways to get it wrong, and all three
cost a turn or poison the next one. This is the contract, whether the repo uses
`process-compose` (`.dev/kit/devstack/`) or a single `just dev`.

## Never hold a long-lived process in the foreground

A dev server does not exit. Starting one in the foreground blocks the turn until
something kills it — the tool times out, the output is truncated, and nothing was
learned. **Long-lived processes are started detached, by the recipe that owns
them.** `just up` (or `just dev`), never `npm run dev` typed directly.

## Never leave an orphan

No `cmd &`, no `nohup`, no backgrounded shell that outlives the turn. An orphan
holds its port, so the next `up` fails with a diagnostic about the port and not
about the code — and it survives the session that created it, which means the
human inherits it. **One owner of lifecycle: `just up` / `just down`.**

Corollary: never `kill` by pid, and never hunt a port with `lsof`/`fuser`. If a
process must go, `just down` (or `just restart <svc>`) takes it, and the
supervisor's own state stays true.

## Ask the supervisor for a log — never tail the file

A service's behavior is an observation you must go and fetch: `just logs <svc>`
after an action, every time. "It should work now" is not an observation; a log
line is.

**Do not read `.logs/<svc>.log` to find out what just happened.** That file is
written in blocks and flushed in full only when the stack stops: measured on
process-compose, a service that printed one line has a **zero-byte** log file for
as long as it keeps running, while `just logs` returns that line immediately. A
chatty service crosses the block quickly and looks fine, which is what makes the
trap survive casual testing. Tailing it produces the precise failure this rule
exists to prevent — you act, you read nothing, you conclude nothing happened.

The file's job is grepping a long history, and post-mortem once the stack is
down. It is never the read you make mid-turn.

The corollary that actually bites: **a service does not pick up your edit unless
it reloads.** Do not assume hot reload — after changing code a running service
loaded, `just restart <svc>` and re-read its log. A green assertion against a
stale process is a false green (`agent/autonomy.md`, "Never fake green").

## Running the app is never the proof

`just check` is what says the code is correct. A working local stack is how you
*observe* behaviour — it is evidence for a diagnosis, never a substitute for the
gate, and never a reason to skip one.
