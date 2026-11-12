# hooks — the harness tier of the gate layer (opt-in, wired by hand)

`rules/agent/autonomy.md` states in prose what an agent must never do: bypass a
hook, disable the gate layer, forge the review report. Prose can be persuaded.
This directory is the part that cannot.

## Two layers, and they do not replace each other

| Layer | Mechanism | Catches | Portable? |
|-------|-----------|---------|-----------|
| **git floor** | `lefthook` (`../lefthook.snippet.yml`) | what git can SEE: a commit on the trunk, a push with an unanswered `CRITICAL` | yes — every agent, every machine, CI included |
| **harness** | per-tool hooks (this directory) | what git never gets to see: the `--no-verify`, the `lefthook uninstall`, the `rm` on the report | no — one dialect per tool |

The floor is the same for both targets, so it is where a guarantee belongs. The
harness layer is depth, per tool. **Never the only rampart.**

(Not to be confused with the kit's `Tier 1-4`, which grade gates by *cost* —
lint / check / review / mutation. These two layers are about *where* a bypass is caught.)

## What it does NOT do

Be honest about the boundary or the whole thing becomes theatre:

- `.claude/settings.json` protects itself through `edit-guard`, and `bash-guard`
  escalates the obvious shell rewrites of it — but the set of ways to write a file
  from a shell is not enumerable. A determined agent gets through.
- Both guards **fail open**: an unreadable payload is reported on stderr and the
  command proceeds. A guard that bricks a session on its own bug is worse than one
  that misses a case.
- A hook can be unwired by whoever can edit `settings.json` outside the agent.

So: these hooks raise the cost of drift and make it **loud**. *Impossibility* lives
somewhere else — server-side branch protection, and the orchestrator that owns the
merge. Do not sell more than that.

## The two guards

**`bash-guard.mjs`** — `PreToolUse` on `Bash`. Two verdicts:

- **deny** (exit 2, reason on stderr → back to the agent): commands with no
  legitimate form — `--no-verify`, `git commit -n`, `core.hooksPath`,
  `lefthook uninstall`, `LEFTHOOK=0`/`SKIP=`, force-pushing or deleting the trunk,
  a `git merge`/`git pull` naming a `phase/*` ref (`just l4-merge` merges a phase),
  and any *write* aimed at `.work/review-report.md`, an L4 journal `l4.jsonl` or `.git/hooks/` — a
  mutating command (`rm`, `mv`, `cp`, `tee`, `ln`, `install`, `touch`, `chmod`,
  `chown`, `truncate`, `dd`, `sed -i`) or a redirect. Reading them is not a write:
  `cat`, `grep` and `sed -n` pass, because a guard that blocks its own diagnostic
  invites being unwired.
- **ask** (JSON): the command *writes* to the gate layer — a `lefthook.yml`, a
  workflow, the `justfile`, a ratchet baseline, `mutants.toml`. Sometimes that is
  the task, so a human decides. A forge merge (`gh pr merge`, `glab mr merge`,
  `tea pulls merge`) asks too: it is the human's act, and sometimes what they asked for.

The L4 entries — `l4.jsonl` and `git merge`/`git pull` naming `phase/*` — are depth,
not the authority: `l4-merge` re-judges and merges on its fresh verdict alone, so a
forged journal line or a hand merge buys nothing the referee would not give. They deny
the spellings their tests list and fail open, like the `review-report.md` entries; a
spelling that gets past them is not a hole to plug with another pattern.

Quoted text is scrubbed before matching, so `git commit -m "drop the -n flag"` is
not a bypass. Matching stays inside the current `|;&` segment, and the write and the
gate file must be *correlated* — the redirect has to target the gate file, or the
mutating command has to carry it. Tested independently, `just check > /dev/null;
node .dev/kit/common/docs-check.mjs` escalates, and that command RUNS the gate rather
than writing it.

The gate layer includes `*.just`: the recipes live in the imported library, so guarding
only the `justfile` that holds the `import` lines would leave the commands unguarded.

**`edit-guard.mjs`** — `PreToolUse` on `Edit|Write`. Two verdicts, like its sibling:

- **deny** for the paths with no legitimate hand-edit: `.work/review-report.md`
  (hand-writing it forges the verdict `review-guard` reads), `.work/<slug>/l4.jsonl`
  (the L4 journal — the rejected rounds the referee counts) and `.git/hooks/`
  (`lefthook install` owns those files). `autonomy.md` calls both a HARD bypass, and
  `bash-guard` denies the shell spelling — an ask here would leave the strongest rule
  in the doctrine enforced by the weaker half.
- **ask** for everything else on the list, because editing it is sometimes the task:
  `/ci-setup`'s whole job is editing a workflow. The list is short on purpose — the
  hook layer itself (including these two files: the meta-bypass), the `justfile`
  (`check` is what "green" means), the ratchets, the review prompt.

Interactively, "ask" is one keypress. **Headless, "ask" blocks** — which is the
intended answer for an unattended agent rewriting its own gates.

Too noisy for your repo? Drop `justfile` from `PROTECTED` first — it is the entry
most likely to be edited for honest reasons.

## Wiring, per tool

The installer never writes any of these files (same contract as `lefthook.yml` and
the `justfile`): it ships the snippet, you merge it.

| Tool | Mechanism | Merge | Confidence |
|------|-----------|-------|------------|
| **Claude Code** | `PreToolUse` hooks | `settings.snippet.json` → `.claude/settings.json` | verified against the hook API |
| **Cursor** | agent hooks (`.cursor/hooks.json`, `version: 1`) | `cursor-hooks.snippet.json` | shell tier verified; **no pre-edit hook exists** (`afterFileEdit` is post-hoc), so tier 2 is shell-only |
| **Codex** | project hooks (`.codex/hooks.json`) | `codex-hooks.snippet.json` — the rule loader only, not the guards | payloads verified on Codex CLI 0.167.0 |

One guard script serves Claude Code and Cursor. Cursor's `beforeShellExecution` payload
carries `command` at the top level (Claude nests it under `tool_input`) and expects
`{"permission": …}` (Claude expects `hookSpecificOutput`); `bash-guard.mjs` detects
the dialect from the payload and answers in kind. Exit 2 means "blocked" to both.

## The Codex rule loader

Not a guard: **`rule-loader.mjs`** hands Codex the path-scoped rules Claude Code loads
by glob. Codex reads `.agents/rules/` only because `AGENTS.md` asks it to; this hook
delivers a rule when the session touches a file its globs match.

- **`apply_patch`** — the paths come from the patch headers (`Add File`, `Update
  File`, `Move to`), so they are exact. A matching rule not yet delivered in the session
  **denies the patch once**, with the rules as the reason; the same patch sent again
  passes.
- **`Bash`** — path-like tokens of the command are a guess, so a match **injects** the
  rules as context and never blocks. A read is never refused on a guess.
- The rules and their root-relative globs come from `codex.rules` in
  `.claude-rules.lock`, re-read on every call; the root is the nearest ancestor of the
  session `cwd` holding the lock. Rules without `paths:` stay in `AGENTS.md`.
- A rule is delivered once per session. The delivered rules are kept in a state file
  under the OS temp directory, keyed by session, in a per-user directory that must be
  private (`0700`, owned by you) to be trusted — never inside the repository.
  `SessionStart` with source `compact` clears it: compaction may drop the injected text.
- Bodies are inlined up to 6 KB per answer; past it the answer lists the rule paths to
  read. Codex spills larger hook output to disk.

**Wiring.** Merge the `hooks` key of `codex-hooks.snippet.json` into
`<repo>/.codex/hooks.json`, then open `/hooks` in Codex and trust both entries: Codex
skips a project hook until it is trusted. **Re-open `/hooks` after every kit update** —
Codex records trust against the hook's hash and skips a changed hook until it is
trusted again. Hooks run with the session `cwd`, which may be a module directory, so the
command finds the kit from the git root; if the claude-rules root is not the git root,
write that path instead. `claude-rules doctor` warns when Codex is a target and
`.codex/hooks.json` does not reference the loader.

**What it does not guarantee.**

- That the model *applies* a rule. It guarantees the rule was in front of it before the
  first patch on a matching file — no more.
- Coverage of every write: a file written from a shell command (`cat > a.rs`, `sed -i`)
  gets at most the `Bash` injection, and only when a token names the path.
- Delivery when anything is off: an unreadable payload, no lock, a lock without
  `codex.rules`, a rule file missing on disk or a patch path outside the repo root
  answers nothing, with one line on stderr. When the state file cannot be written, or its
  directory is not private, it injects instead of denying — a deny it cannot remember would block the patch forever.
- An untrusted or unwired hook: `doctor` reads `.codex/hooks.json` only. Inline hooks in
  `config.toml` and the trust state are not inspected.

The `AGENTS.md` reading instructions stay: they are the floor for every repo that does
not wire the hook.

## Verifying it works

The guards are plain Node with no dependencies, so they are testable — and tested,
in `test/hooks.test.mjs` of this library (the rule loader in `test/rule-loader.test.mjs`). In a consuming repo:

```bash
echo '{"tool_input":{"command":"git commit --no-verify -m x"}}' \
  | node .dev/kit/common/hooks/bash-guard.mjs; echo "exit=$?"   # → exit=2
echo '{"tool_input":{"command":"git commit -m \"drop the -n flag\""}}' \
  | node .dev/kit/common/hooks/bash-guard.mjs; echo "exit=$?"   # → exit=0, silent
```

For the Codex loader, name a file one of your path-scoped rules governs (a fresh
`session_id` each time, or the second run stays silent):

```bash
echo '{"hook_event_name":"PreToolUse","session_id":"'"$RANDOM"'","cwd":"'"$PWD"'","tool_name":"Bash","tool_input":{"command":"cat src/main.rs"}}' \
  | node .dev/kit/common/hooks/rule-loader.mjs   # → {"hookSpecificOutput":{…"additionalContext":…}}
```

A hook that is wired but never fires is indistinguishable from no hook at all —
run the two lines above once after merging the snippet.
