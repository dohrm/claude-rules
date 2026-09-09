# Local dev stack — a just LIBRARY, imported by the repo's root justfile:
#
#     import '.dev/kit/devstack/devstack.just'
#
# `claude-rules init` writes that line for you, and `claude-rules update` refreshes
# THIS file — so a fix here reaches a repo that installed months ago. Do not edit it:
# override instead. A recipe or variable in the root justfile wins over an imported
# one, which is what the `set allow-duplicate-*` lines at the top of that file buy.
#
# Recipes run with the working directory of the ROOT justfile, never of this file, so
# every path below is repo-relative.
#
# NOT A GATE. Nothing here belongs in `check` or in a hook: running the app is how you
# OBSERVE behaviour, never what proves it (rules/devstack/running.md). The doctrine
# these recipes implement is that rule; this file is only its lifecycle.

# The stack definition. Copy process-compose.snippet.yaml → process-compose.yaml at the
# repo root and adapt it — the installer never merges it for you.
pc_config := "process-compose.yaml"

# Where each service's log lands. Gitignore it: these are per-machine observations,
# never an artifact. Read them with `just logs`, NOT by tailing the file — see the
# comment on that recipe, it is the least obvious thing in this kit.
logs_dir := ".logs"

# ── Instance isolation, and why it is not optional ─────────────────────────
# process-compose serves its control API on TCP :8080 by default. Two work trees of
# the same repo — the whole point of `git worktree` (rules/agent/autonomy.md, "One
# tree, one writer") — then fight over that port, and `just restart api` in one tree
# silently drives the OTHER tree's stack. A unix socket per tree removes the class of
# bug: `-U` switches transport, `-u` names the socket.
#
# The name is derived from the tree's directory, which is also the bench name, so the
# socket of a tree is guessable and `fleet`'s unit and this one agree. In /tmp rather
# than in-tree on purpose: a unix socket path is capped near 104 bytes on macOS, and a
# deep monorepo path plus `.logs/pc.sock` gets close enough to matter.
#
# Two DIFFERENT repos whose directories share a basename would collide — override
# `pc_socket` in the root justfile if that is you.
pc_socket := "/tmp/pc-" + file_stem(justfile_directory()) + ".sock"
pc        := "process-compose -U -u " + pc_socket

# Start the stack DETACHED and return. Detached is the whole point: the stack outlives
# the pane that started it and the agent turn that asked for it, so nothing is holding
# a foreground process and nothing is orphaned when the shell goes away. Measured:
# returns in ~0.5s.
# `--tui=false` because a TUI nobody is watching is just a renderer burning CPU —
# `just stack` is how a human looks at it.
up:
    mkdir -p {{logs_dir}}
    {{pc}} up --detached --tui=false --config {{pc_config}}
    @echo "stack up (detached) - state: just ps - read one service: just logs <svc>"

# Stop every process AND the process-compose server, so the socket goes with it.
# This is the ONLY correct way to stop the stack: no kill by pid, no hunting a port.
# It is also what FLUSHES the per-process log files (see `logs`).
down:
    -{{pc}} down
    @echo "stack down"

# One service, restarted. The recipe an agent runs after editing code that service
# loaded — a running process does not pick up an edit unless it reloads, and assuming
# it did is how a false green happens (rules/devstack/running.md).
restart svc:
    {{pc}} process restart {{svc}}
    @echo "restarted {{svc}} - now read it: just logs {{svc}}"

# State of every process: PID, status, age, health, restarts, exit code. The cheap
# first question. `-o wide` is what produces the table; bare `process list` prints
# names only.
ps:
    {{pc}} process list -o wide

# ── Reading a log, and why NOT `tail` ──────────────────────────────────────
# ASK THE SUPERVISOR, never the file. Measured on process-compose 1.x: the
# per-process `log_location` file is written in 4 KB blocks and only flushed in full
# at shutdown. A chatty service crosses the block quickly and looks fine; a quiet one
# does not — a service that printed one line has a file of ZERO bytes for as long as
# it keeps running, while `process logs` returns that line immediately.
#
# So tailing the file is exactly the false signal rules/devstack/running.md exists to
# prevent: you act, you read nothing, you conclude nothing happened. `process logs`
# reads the supervisor's live buffer and is authoritative and immediate. It also
# returns clean text, where the FILE holds one JSON object per line
# ({"level":"info"|"error","process":…,"message":…} — info is stdout, error stderr).
#
# The file still has a job: grepping a long history after the fact, and post-mortem
# once `just down` has flushed it. It is never the read an agent makes mid-turn.
logs svc n="50":
    {{pc}} process logs {{svc}} -n {{n}}

# Follow it live. For a human, or for an agent that knows it is about to trigger
# something. Ctrl-C to stop — this one does not return on its own.
follow svc:
    {{pc}} process logs {{svc}} -f

# The ports a service actually listens on. The one question `just ps` does not answer,
# and the first thing to ask when two trees fight over a port (which this kit does NOT
# solve for your app — see README.md).
ports svc:
    {{pc}} process ports {{svc}}

# Attach the interactive TUI to the detached stack: CPU/RAM per process, F5/r to
# restart one, scrollable logs. Detaching leaves the stack running — that separation
# (headless supervisor, TUI on demand) is why the stack survives closing a pane.
stack:
    {{pc}} attach

# Validate process-compose.yaml without starting anything. Cheap to run after editing
# the stack definition, and the one recipe here that is safe in CI.
stack-check:
    {{pc}} up --dry-run --config {{pc_config}}
