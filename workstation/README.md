# workstation — the operator's bench, not a repo asset

Everything here runs **outside** every repo, so nothing in this directory is
reachable from `registry.json` and nothing is ever installed into a consuming
repo. That is deliberate: a zellij layout is not path-scopable and a cross-repo
dashboard cannot be a per-repo copy (four checkouts, four copies, none
authoritative). `claude-rules`' contribution to this workflow is the **file
contract** these tools read — `.work/<slug>/loop.md`, its
`## Blocked on the human` section, `.work/review-report.md`. The reader is
personal tooling; the contract is the library.

## Vocabulary

**Bench** — one unit of work: a tree (a repo or a worktree) + the zellij session
driving it + its `.work/<slug>/` state. `bench` opens one, `fleet` shows them all.

## Install

```bash
ln -s "$PWD/workstation/bin/bench" ~/.local/bin/bench
ln -s "$PWD/workstation/bin/fleet" ~/.local/bin/fleet
ln -s "$PWD/workstation/layouts/bench.kdl" ~/.config/zellij/layouts/bench.kdl
ln -s "$PWD/workstation/layouts/fleet.kdl" ~/.config/zellij/layouts/fleet.kdl
```

Node >= 18, no dependencies, no build. `git` and `zellij` are read via the shell;
both are optional — a bench with neither still shows up, with `—` in the columns
they would have filled.

## Use

```bash
bench start .                 # register this tree, open/attach its zellij session
bench start ../repo-billing   # a worktree is a bench of its own
bench register .              # register only — for a bench you drive from a GUI host
bench done hal                # unregister; never kills the session, never touches the tree
fleet                         # the whole fleet, one line each
```

Then, once, a session you come back to:

```bash
zellij --session fleet --layout fleet
```

`fleet` is a zellij **Command Pane** there: it prints, exits, and the pane stays
open showing the exit code. **Enter re-runs it.** No polling loop, no daemon, and
your scrollback survives — you can scroll back to what the fleet looked like an
hour ago.

## What `fleet` reads, and why three sources

| Source | The one question it answers |
|---|---|
| the registry (`$XDG_STATE_HOME/claude-rules/benches/`) | which benches are **open**, and **where** |
| `zellij list-sessions` | which one is **live** right now |
| `.work/<slug>/*.md` | where it **stands**, and whether it is **blocked on you** |

None is redundant, and the split is what makes the tool host-agnostic. A
`loop.md` written by `cursor-agent` in Cursor's GUI is the same file as one
written by the Claude Code CLI, so `fleet` sees both. Only the *action* column is
zellij-specific — a bench you drive from a GUI shows `dormant` and no attach
command, which is itself the information ("that one lives in its own host's
view").

Two properties that carry the design:

- **The registry is durable.** Work waiting on you does not stop waiting because
  you closed a terminal. A bench stays listed until `bench done`, and a dormant
  bench with a non-empty `## Blocked on the human` is exactly the line that
  belongs at the top.
- **`mtime` is the liveness signal.** A state file untouched for an hour means a
  loop that stopped — true on every host, needing no hook. Claude Code has
  `Notification` hooks (`idle_prompt`, `agent_needs_input`) and Cursor has none;
  building on them would have covered a third of the parc.

`fleet` is read-only, has no LLM, and **always exits 0**: a dashboard that fails
is a dashboard nobody runs. The verdict it prints is a *report* of a gate, never
the gate — that stays `just review-guard`, inside each bench, at push time.

## The layout, and the two-writer hazard

`bench.kdl` is two tabs and nothing else: **loop** and **workshop**. `Alt+1/2`
switches role, `Ctrl+o w` switches bench — two gestures, two distinct meanings.
Both panes are bare because they are where you *type*; anything transient (the
stack, a curl, a `git diff`) goes in the floating pane (`Alt+w`) and disappears.

There is deliberately **no git-watch pane**. A `while true; clear; git status`
loop repaints a screen you are not reading and destroys your scrollback, and the
question it fails to answer is the only one that matters — *does it want me?*
That is `fleet`, one session over.

The workshop exists so the loop's context stays monomaniacal about its bounded
objective. But it shares the loop's checkout, so:

> **Hand-editing code from the workshop is a transaction, not a habit.** The loop
> must be at rest, and you declare the edit in the state file's `## Log` as
> `human: <what and why>`. An undeclared edit loses to the agent's next turn —
> it re-reads the tree as if it authored it (`rules/agent/autonomy.md`, "One
> tree, one writer").

If you find yourself hand-fixing often, that is a signal about the **cut**, not
about the agent: an item that needs exploration failed `loop-setup`'s third
precondition (*end-to-end doable*) and should have been an `/investigate`, not a
loop item.
