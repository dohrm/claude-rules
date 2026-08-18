# Changelog

What changed for a repo that **installs** these assets — not a record of the work.
Newest first, grouped by impact, breaking changes and their migration first.

> This file starts with the entries below. Nothing before them was ever tagged, so
> there is no release to reconstruct; that history lives in the git log.

**Versioning.** SemVer on the *asset contract*: an installed rule, skill, kit file or
CLI flag a consuming repo depends on. **We are on `0.x`, where MINOR is the breaking
slot** — pin a ref (`--ref <tag>`) if you need the guarantee `0.x` does not give.

## [Unreleased]

### Changed

- **BREAKING — `/loop-setup` keeps its state in one file under `.work/`.** It used to
  write `PLAN.md` and `MEMORY.md` at the repo root; it now writes a single
  `.work/loop.md` (bounded objective, guardrails, remaining work, log, escalations).
  The old name collided head-on with the durable `docs/PLAN.md` that `/plan` owns —
  two files, one name, opposite lifetimes: one is a promise kept for the life of the
  project, the other is scaffolding that dies with the branch.

  **Migration** — only if a loop is in flight. Nothing breaks silently: the skill
  simply will not find the old files, and a restarted loop would begin with an empty
  log, losing the dead ends it must not retry.

  1. Create `.work/loop.md` from the skill's template.
  2. Move `PLAN.md`'s checklist under `## Remaining work`, `MEMORY.md`'s entries under
     `## Log`, and anything that was waiting on you under `## Blocked on the human`.
  3. Delete the two old files and add `.work/` to `.gitignore`.

  With no loop running, delete the two files and move on.

### Added

- **The gate layer got teeth, in two layers** (shared `kit/common`). `rules/agent/autonomy.md`
  said in prose what an agent must never do; now something enforces it.

  **The git floor** — `common/lefthook.snippet.yml` gains a pre-commit
  `no-commit-on-trunk` (a no-op off `main`/`master` via `only: ref`). Portable across
  every agent and CI, which is why the guarantee lives here. `claude-rules init` now
  writes it into a generated `lefthook.yml` — and writes that file even when no
  language is locked, since the floor holds in a docs-only repo too. **Opt-out:**
  a solo repo that really commits on `main` deletes the one command; the snippet says so.

  **The harness layer** — new `common/hooks/`, opt-in, one wiring snippet per tool.
  `bash-guard.mjs` **denies** `--no-verify`, `git commit -n`, `core.hooksPath`,
  `lefthook uninstall`, `LEFTHOOK=0`/`SKIP=`, force-pushing or deleting the trunk, and
  any `rm`/`sed`/redirect aimed at `.work/review-report.md`; it **asks** when a command
  writes to the gate layer itself. `edit-guard.mjs` always asks, never denies —
  `/ci-setup`'s whole job is editing a workflow. Merge
  `settings.snippet.json` into `.claude/settings.json` (the installer still never
  writes it), or the `opencode`/`cursor`/`codex` snippet beside it.

  **`doctor` audits the wiring.** New `Gate layer` section: it **fails** on a
  `lefthook.yml` git was never told about (`lefthook install` was never run — the file
  looks installed and every hook in it is inert) and on a hook wired to a guard script
  that is not on disk; it **warns** on a host config that is not valid JSON; and it
  reports an unwired harness layer as a **notice that never scores**, because opt-in
  absence is a decision, not drift. Per agent, so it names `.dev/kit` for Cursor and
  `.claude/kit` for Claude, and says plainly that Codex has no hooks and Antigravity
  no mechanism.

  **What it is not:** both guards fail open, `settings.json` is not fully
  self-protecting, Cursor has no pre-edit hook, Codex has no hooks at all (a sandbox
  is a different promise), and Antigravity degrades to the git floor. This makes drift
  expensive and loud, never impossible — impossibility is branch protection.
  `common/hooks/README.md` is the honest version.

- **`just code-review` + `just review-guard`** (shared `kit/common`) — a local code
  review with teeth. `just code-review` runs a reviewer as its own **read-only**
  process over `git diff <base>...HEAD` (any agent CLI — set `review_cmd`: `claude -p`,
  `codex exec`, `opencode run`, `cursor-agent -p`) and parks its report in
  `.work/review-report.md`. The report ends with two machine-readable markers,
  `CI_VERDICT` and `REVIEWED: <sha>`, and `just review-guard` — pure Node, no LLM,
  milliseconds, so it can be a **pre-push hook** — reads them: a `CRITICAL` blocks the
  push **whatever sha it was written against**, a malformed report blocks, an absent
  one passes with a "not run" notice (declared, never simulated), and a stale
  `CLEAN`/`WARNINGS` passes with a notice.

  The hole this closes: a verdict that expires with HEAD is a verdict you defeat by
  committing once more. The only way out of a `CRITICAL` is a fix and a NEW review —
  and hand-editing or deleting the report is now a hard "never fake green" bypass
  (`rules/agent/autonomy.md`, where the review joins `mutate-diff` at the second
  speed of the loop).

  **Wiring** (opt-in, like `adr-check`): move `review-guard.mjs` **and**
  `review-prompt.md` to `scripts/`, merge `common/lefthook.snippet.yml` (pre-push,
  no glob) into `lefthook.yml`, gitignore `.work/`. The prompt is the same review
  contract as the `code-reviewer` subagent — one block, duplicated on purpose,
  test-enforced identical.

- **`/tasks`** (profile `product`) — the missing step between a plan and code. It takes
  **one** phase of `docs/PLAN.md` and cuts it into tasks an agent loop can execute:
  the anchors in your existing code (where each layer attaches, and the nearest
  neighbour to imitate), a first task that freezes the phase's contract **as code**,
  then tasks sized to the *green boundary* — the smallest change that leaves the gate
  green, which is what makes one-commit-per-task true and the branch bisectable.

  Output is `.work/phase-NN-<slug>.md`: gitignored working memory, never a document
  under `docs/`. The phase's promise stays in `docs/plan/`, the account of what
  happened is the git log. Run it when a phase *starts*, not once for every phase —
  the code will have moved.

  `/loop-setup` composes with it: given a phase worklist it adds only its guardrails
  section to that file rather than writing a second plan.
