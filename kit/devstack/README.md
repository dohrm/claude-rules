# devstack — the local stack, and the contract an agent has with it

Two halves, and only the first is prose:

- `rules/devstack/running.md` — the **contract**: never a foreground server, never
  an orphan, the log file is the truth, a running process does not pick up your
  edit. True in any repo, `process-compose` or not.
- this kit — the **lifecycle** that makes the contract cheap to honour.

**Not a gate.** Nothing here goes in `check` or in a hook. Running the app is how
you observe behaviour; `just check` is what proves the code. The one exception is
`stack-check` (`--dry-run`), which validates the YAML and starts nothing.

## Install this only if the repo runs more than one process

In practice that is almost every repo that has a UI: a front/back monorepo is
already two processes, before you count the database. The threshold is met sooner
than it sounds.

The exception is a genuinely single-process repo — a library, a CLI, a lone
`vite dev`. There, skip this kit: a `just dev` recipe that starts the one thing
detached is enough, and the rule above still applies. `process-compose` earns its
place when there is **ordering** (the api must wait for the db to *answer*, not
merely to be spawned), a **restart policy**, and a **control API** an agent can
drive.

## Wiring (manual, as always)

1. `claude-rules init` writes `import '.dev/kit/devstack/devstack.just'` into the
   root justfile. Never edit the `.just` under `.dev/kit/` — `update` overwrites it.
2. Copy `process-compose.snippet.yaml` → `process-compose.yaml` at the repo root
   and adapt it. It is a shape (dependency → backend → frontend), not a stack.
3. Gitignore the logs and the socket leftovers:
   ```
   .logs/
   ```
4. Install the binary: `brew install f1bonacc1/tap/process-compose`, or
   `go install github.com/F1bonacc1/process-compose@latest`.
5. `mkdir -p ~/.config/process-compose` — **do not skip this.** Without that
   directory, process-compose prints two JSON debug lines on stderr for *every*
   invocation (`Path not found for process compose config home`), so every recipe
   output an agent reads starts with noise it has to parse past. Creating the empty
   directory silences it.
6. `just stack-check` — validates the YAML without starting anything.

## The recipes

| Recipe | What it does |
|---|---|
| `just up` | starts the stack **detached**, returns immediately |
| `just down` | stops every process *and* the supervisor (so the socket goes too) |
| `just ps` | PID / status / age / health / restarts / exit code (`process list -o wide`) |
| `just restart <svc>` | one service — what you run after editing code it loaded |
| `just logs <svc> [n]` | last n lines **from the supervisor**, not from the file (default 50) |
| `just follow <svc>` | follow it live (does not return; Ctrl-C) |
| `just ports <svc>` | the ports that service actually listens on |
| `just stack` | attaches the interactive TUI; detaching leaves the stack up |
| `just stack-check` | `--dry-run` on the config |

Rename any of them in the root justfile if it collides with one you already have —
same contract as `just status` in `kit/common`.

## Three decisions worth knowing about

**Never tail `.logs/<svc>.log` to see what just happened — and this one is
measured, not assumed.** process-compose writes each per-process log file in 4 KB
blocks and flushes it in full only at shutdown:

```
                       while running    after `just down`
big.log   (400 lines)     40960 B          42692 B     ← crossed the block
small.log (1 line)            0 B             67 B     ← invisible until shutdown
```

A chatty service crosses the block in seconds and looks perfectly fine, which is
exactly why this trap survives casual testing. A quiet one — the health endpoint
that logged one failure, the worker that printed one stack trace — has a
**zero-byte** file for as long as it runs. `just logs <svc>` asks the supervisor's
live buffer instead: authoritative, immediate, and it returns clean text where the
file holds one JSON object per line (`{"level":"info"|"error","process":…,
"message":…}` — `info` is stdout, `error` is stderr).

The file keeps a job: grepping a long history, and post-mortem once `down` has
flushed it. It is never the read an agent makes mid-turn
(`rules/devstack/running.md`).

**Detached, headless, TUI on demand.** `up` passes `--detached --tui=false`. The
supervisor outlives the pane that started it and the agent turn that asked for it,
so closing a terminal does not take the stack down and nothing is left orphaned
when a shell goes away. A human who wants the dashboard runs `just stack` and
detaches again. The draft this replaced ran the TUI in the foreground of a zellij
pane, where closing the pane killed the stack and the renderer burned CPU nobody
was watching.

**A unix socket per work tree, and it is not optional.** process-compose serves
its control API on TCP `:8080` by default. Two work trees of the same repo — the
whole point of `git worktree`, and what `rules/agent/autonomy.md` requires for
parallel work — then fight over that port.

Measured, because the failure mode is worse than "the second one refuses to
start": the second `up` **reports success with no port error at all**, and a
`process list` on `:8080` afterwards returns one view that does not say which tree
it describes. There is no diagnostic anywhere pointing at the real cause, so an
agent that sees a service misbehaving debugs its own code while the interference
comes from a sibling checkout. With the socket, the same test is clean — two
stacks up at once, and `just restart web` in one tree left the other tree's PID
untouched:

```
my-stack    web PID : 40005 -> 40005   untouched
other-stack web PID : 40265 -> 40372   restarted
```

`devstack.just` passes `-U -u
/tmp/pc-<tree>.sock`, derived from the tree's directory name, which is also its
bench name (`workstation/README.md`). In `/tmp` rather than in-tree because a unix
socket path is capped near 104 bytes on macOS and a deep monorepo path gets close.
Two *different* repos whose directories share a basename would collide — override
`pc_socket` in the root justfile if that is you.

## What this does NOT solve

**Your app's own ports.** process-compose isolates its control plane, not your
services: two trees both starting the api on `:8000` still collide. The opinion
here is to not solve it — **one tree runs the stack at a time**, the one you are
working in. The others run `just check`, which needs no server. If you genuinely
need two live stacks, derive a per-tree offset from an untracked `.env`
(process-compose loads `.env` by default) and thread it through the ports in
`process-compose.yaml`; that is a repo-specific decision, not something a shared
kit should guess.
