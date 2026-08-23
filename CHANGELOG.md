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

- **Rust is the first language jalon.** `just rust-lint` now denies
  `clippy::unwrap_used` / `expect_used` on `--lib --bins` (tests stay free).
  `rules/rust/quality-gates.md` is a pointer: the recipes, the configs they
  read, suppressions. Copy `rustfmt.toml` next to `deny.toml` and
  `mutants.toml` — the map is `.dev/kit/rust/README.md`. Style, errors,
  tracing, UTF-8 stay prose; they are not translated into a fourth clippy
  pass.

- **Python is the second language jalon.** `rules/python/quality-gates.md`
  is a pointer: the recipes, the `pyproject.toml` tables they read,
  suppressions. Merge `pyproject.snippet.toml` — the map is
  `.dev/kit/python/README.md`. `S` / `TRY` / `G` stay in ruff; layout,
  domain errors, `extra=` log fields stay prose. Every recipe line is
  `uv run --locked`.

- **Rust and Python sibling rules shrink to a mention** where the jalon
  already gates (clippy / ruff / mypy / `--locked`). What remains is only
  what the toolchain cannot see.

- **Go is the third language jalon.** `rules/go/quality-gates.md` is a
  pointer: `just go-lint` / `go-check` / `go-cover`. Copy
  `golangci.base.yml` → `<go_dir>/.golangci.yml` — the map is
  `.dev/kit/go/README.md`. The shipped file is **golangci-lint v2**
  (`gofmt` under `formatters`, `gosimple` folded into `staticcheck`);
  `golangci-lint migrate` if you still own a v1 file. slog, proto /
  `pb.*`, `internal/`, `%w` stay mentions.

- **TypeScript is the fourth language jalon, with three derivatives.**
  Recipes own the tools (`npm exec --no-install -- eslint / tsc / vitest`)
  — they no longer delegate to `npm run lint`. `ts` is the floor
  (`no-explicit-any`, `no-non-null-assertion`, `strict`). `ts-web` and
  `ts-tauri` add react-hooks + jsx-a11y + DOM; `ts-node` adds Node
  globals and drops DOM. Fastify schemas, Zustand / invoke, kebab-case
  filenames stay mentions. Maps: `.dev/kit/ts/README.md` and the
  derivative READMEs.

### Breaking

- **Codex, OpenCode and Antigravity are no longer targets.** The installer emits
  for Claude Code and Cursor only (`--agent claude,cursor`; default: both).
  `--agent codex` / `opencode` / `antigravity` fails. An old lock that still lists
  them is rewritten on `add`/`update`; leftover `.dev/rules/`, `.opencode/`,
  `.agents/rules/` and the managed `AGENTS.md` block are purged. `doctor` fails
  until that `update` has run. Nested `CLAUDE.md` / `AGENTS.md` is now possible
  (the Codex-concatenates / OpenCode-replaces conflict is gone) — the installer
  does not emit those files yet.

- **`/rust-add-domain` is gone.** It was a transformation recipe for one AppState DI
  scaffold, not a reusable methodology — the `hexagonal` profile keeps the rules
  (`rust-di-container.md` and friends), not the skill. After `update`, delete the
  leftover copy (`doctor` will flag it): `.claude/skills/rust-add-domain`,
  `.agents/skills/rust-add-domain`, `.opencode/skills/rust-add-domain`.

- **The kit has one home: `.dev/kit/`, for every agent.** It was `.claude/kit/` for
  Claude and `.dev/kit/` for the other four. The kit is the only asset kind no emitter
  transforms — executable gates, copied verbatim — and nothing reads it automatically
  the way Claude reads `.claude/rules/`: its only consumers name the path themselves
  (the justfile, `lefthook.yml`, `settings.json`). So the per-agent destination bought
  nothing and cost two things: a second identical tree in a multi-agent install, and a
  justfile whose import path depended on which agent happened to be first in the lock.

  **Migration** — `add`/`update` move it for you and purge the old tree (by name, one
  registry-known directory at a time; anything you put under `.claude/kit/` yourself
  survives). What they cannot rewrite is the paths you wired by hand:

  ```bash
  npx github:dohrm/claude-rules update
  grep -rn '\.claude/kit' justfile lefthook.yml .claude/settings.json .github .gitea 2>/dev/null
  ```

  Anything that turns up becomes `.dev/kit/…`. `claude-rules doctor` reports a wired
  guard whose script is not on disk, so a missed path shows up as a problem rather
  than as a hook that silently never fires.

- **The gates are a `just` library you import, not a snippet you merge.**
  `kit/common/justfile.snippet` is gone. In its place: `kit/common/gate.just` plus one
  file per technology (`kit/rust/rust.just`, `ts`, `go`, `python`, `godot/godot.just`),
  which the repo's root justfile `import`s. The reason is the one that mattered all
  along — a merged snippet could never be updated again, so every fix stayed upstream
  and every installed repo drifted from the day it was installed. An import can be
  updated. Needs **just >= 1.27** (`import` landed in 1.18; the duplicate-override
  settings in 1.27).

  What the root justfile holds now is the *composition*: the imports, the `*_dir`
  variables, `check`, `mutate-diff`, and any recipe or variable it overrides — a
  definition there wins over the imported one, which is how you adapt a gate without
  forking it. `claude-rules init` writes that file; it is ~40 lines instead of ~260.

  Two wiring steps disappear with it. The gate scripts (`adr-check.mjs`,
  `docs-check.mjs`, `review-guard.mjs`, `worktree-status.mjs`, `review-prompt.md`) are
  no longer moved into `scripts/` — the recipes call them where they ship, so an
  update refreshes gate and implementation together. And enabling an opt-in gate is
  now one word in the `check` recipe.

  **Migration** — the installer reports, it never rewrites your justfile:

  ```bash
  npx github:dohrm/claude-rules update && npx github:dohrm/claude-rules init
  ```

  `init` prints the `import` lines and the two `set allow-duplicate-*` lines to add;
  `doctor` warns for as long as a justfile redefines a library recipe instead of
  importing it, naming which ones. The full procedure — including the deterministic
  equivalence proof, since `just --summary` and `just --evaluate` flatten imports
  while `just --dump` does not — is in `.dev/kit/common/README.md`.

  Both guards now treat `*.just` as gate-layer files: the recipes moved, so guarding
  only the file holding the `import` lines would have left the commands unguarded.

- **`portal-flat` no longer ships the HTTP transport — add `portal-http` for it.**
  The profile bundled two independent axes: the flat-domain *architecture* (module
  map, layer boundaries, business boundary) and the *HTTP idioms* (OpenAPI codegen,
  TanStack Query, cache policy). `tauri` needs the first and explicitly forbids the
  second, so a Tauri repo was loading 12.9 KB of rules prescribing TanStack Query on
  its Zustand stores.

  **Migration** — a web portal adds one profile; nothing else changes:

  ```bash
  npx github:dohrm/claude-rules add portal-http        # same globs, same --module anchoring
  ```

  `rules/portal-flat/react.md` → `rules/portal-http/react.md`, and
  `kit/portal-flat/openapi-ts.config.ts` → `kit/portal-http/`. A Tauri app installs
  `portal-flat` + `tauri` and **never** `portal-http`.

### Changed

- **Always-on rules are shorter.** `agent/autonomy.md` is a procedure, not an
  essay. `agent/guardrails.md` and the review contract now treat a comment-only
  hunk as a failed edit: rewrite a comment only when the code change made it
  false.
- **Skill prompts: less restatement, same contracts.** Descriptions dropped the
  8-synonym trigger lists. `/prd` description no longer names a stale 8-section
  template. Skills defer to `product/documents.md` / `agent/decision-records.md`
  instead of reciting budgets. `/experience` dropped the DX/Web/CLI knowledge
  book (anti-slop stays). `/investigate` is agent-agnostic and may instrument
  with a debugger or a failing test, not only tagged logs.

### Added

- **`portal-http/state.md` — server-state ownership and cache-clean policy.** The
  generated TanStack Query code invalidates nothing: the plugin emits option
  factories (`xxxOptions()`, `xxxMutation()`, `xxxQueryKey()`), and the generated
  mutation is a bare `mutationFn`. The rule states who owns server state, where the
  invalidation set is written (`features/{domain}/api/`, not the component), what a
  logout must clear, and what the browser may not recompute.
- **`backend/api-surface.md` — the API models the domain, not the screens.** An admin
  screen and a consultation screen touching the same data are one route and two
  authorizations, not two routes. Includes the "name the difference" table
  (who / which fields / which subset / a real domain operation) and the line between
  a legitimate domain command and a screen-shaped endpoint.
- **`backend/authorization.md` — habilitation, which no rule covered.** Deny by
  default, one permission model in the domain's vocabulary, row-level scope applied
  in the query (never post-filtered — it breaks `total` and pagination), 403 vs 404,
  and the policy/implementation split that `hexagonal` implies.

### Fixed

- **`rules/portal-flat/react.md` claimed generated mutation hooks invalidate related
  queries "by convention". They do not** — verified against two independently
  generated clients: zero occurrences of `invalidate` or `queryClient` in the emitted
  code. The rule promised a behaviour that does not exist, which is worse than saying
  nothing. Corrected, along with the same wrong vocabulary in the plugin table, the
  code example, and the `openapi-ts.config.ts` header comment.
- **`rules/tauri/app.md` was scoped `**/*.rs` while being entirely TypeScript.** It
  loaded on the Rust side, where none of it applies, and never on the stores and IPC
  wrappers it governs. Now scoped `**/*.ts`/`**/*.tsx`. Its state table also moved
  server state from `features/{domain}/logic/` to `features/{domain}/api/`, so a
  Tauri app and a web portal share one module map instead of contradicting it.
- **`features/{domain}/logic/` was chartered as "validation, state machines, derived
  values"** — an invitation to put business rules in the browser. It is now screen
  behaviour only: UI state machines, display derivations, form drafts. A UI
  approximation the product asked for is allowed, labelled as an estimate.

### Fixed

- **`just code-review` could not run, and the gate it feeds could lock a repo out of
  pushing.** Everything here was found by wiring the review into a real repo and using
  it; each one is one line of evidence, not a review of the code.

  - **The prompt never reached the CLI.** It was passed as a trailing positional after
    `--allowedTools`, which is variadic — so the prompt's words were eaten as tool
    rules and the run died with "Input must be provided either through stdin or as a
    prompt argument". It goes in on stdin now.
  - **A failed review blocked every push.** `>` truncates the report before the CLI
    runs, so a CLI that dies (absent, no key, rate-limited, Ctrl-C) left a 0-byte file
    — which `review-guard` read as *malformed*, not *absent*. The hook has no glob, so
    that state blocked every push on the machine, and the documented "no report →
    passes" escape was unreachable because the file existed. The report is now written
    to a temp file and moved into place, and an empty report reads as "not run".
  - **A report that QUOTES the verdict markers was read as malformed.** Any review
    whose fix suggestion shows the output contract — which is exactly what happens when
    the diff touches `review-prompt.md` or the reviewer agent — emitted a second
    `CI_VERDICT` line and was rejected for having two verdicts, reproducibly. The
    markers are now read LAST-wins over the report; earlier ones are prose about the
    contract.
  - **The "read-only reviewer" was not read-only.** `--allowedTools` ADDS to the rules
    the subprocess inherits from `settings.json` and `settings.local.json`; it does not
    replace them. Measured in a worked-in repo: with `--allowedTools 'Read,Glob,Grep'`
    the reviewer ran `just --version`. Denied `Bash`, it reached for `Monitor` — which
    runs a command — and said so in its answer. The recipe now hands the reviewer its
    diff and its sha, so it needs no shell at all, and denies the enumerated executor
    surface. **This is a denylist over a surface a CLI release can grow** — the recipe
    carries the re-enumeration command and says so; the structural half is what holds.

- **`bash-guard` blocked five commands an agent runs on an ordinary day**, and two of
  them were denies, where the only move left is to escalate over a non-issue:
  `git merge --no-verify-signatures` (a GPG flag, nothing to do with hooks),
  `git push --force-with-lease origin feat/fix-main-nav` (the trunk is a whole ref, not
  the word "main" inside a branch name), `cat justfile 2>/dev/null` (an fd redirect is
  not a write to what is being read), `sed -n '1,20p' lefthook.yml` (`sed` writes only
  with `-i` — and the same bug denied reading the review report, so an agent could not
  look at the verdict blocking its push), and `git config --get core.hooksPath` (the
  diagnostic the hooks README tells you to run). The write test is now correlated with
  the gate file instead of matched independently over the whole command.

- **Tightening those patterns opened three ways past the guard's own rules** — found by
  measuring the guard against the commands it exists to refuse, not by reading it. A ref
  and a flag do not END on `(\s|$)`: `;`, `&` and `|` are none of the alternatives, so
  one trailing separator was enough. `git commit --no-verify; git push` and
  `git push -f origin main; echo ok` were both allowed, where the looser patterns before
  them denied both. And the lookbehind meant to spare `2>&1` sat BEFORE the `>`, which is
  exactly where an fd number goes — so `1>`, `2>` and `&>` were exempted while each of
  them truncates a real file on open, and `echo x 2> .git/hooks/pre-commit` emptied a
  hook silently. Both are anchored on what cannot FOLLOW the token now, which still
  refuses to see the trunk in `feat/fix-main-nav`.
- **Half the mutating commands could empty `.git/hooks/` without a prompt.** The
  `.git/hooks/` rule carried its own short list (`rm`, `mv`, `truncate`, `dd`, `sed -i`,
  `chmod -x`) while the gate-file rule thirty lines below also listed `cp`, `tee`, `ln`,
  `install`, `chown` and `chmod` — so `cp /dev/null`, `ln -sf /bin/true`, `install
  -m755` and `chmod 000` all went through, each one neutering the git floor. One list
  feeds both rules now, plus `sed --in-place`. Readers (`cat`, `grep`, `sed -n`) stay
  out of it, on purpose.
- **Editing a document and then running the gate that checks it escalated.**
  `just check > /dev/null 2>&1; node scripts/docs-check.mjs` holds a gate filename and a
  redirect for entirely unrelated reasons — it RUNS the gate, it does not write it — and
  independent matching asked for confirmation on it. That is a prompt on every
  documentation change, interrupting exactly the loop `rules/agent/autonomy.md` asks an
  agent to close by itself.
- **`review-guard` read a fixed 6-line tail, which blocked ordinary reports and missed
  the case it was added for.** A review that signs off with a few lines of prose pushed
  its own markers out of the window, and the push was refused as *malformed*; a contract
  quoted next to the real markers stayed inside the window and still counted as a second
  verdict. The report contract already promises the reviewer that only the last marker
  counts, so that is what runs: the LAST of each marker, over the whole report. Several
  markers is no longer a malformation; a last one that is not a verdict still is.
- **The temp report was named `review-report.md.part`**, which contains
  `review-report.md` — so `bash-guard` denied the recipe's own two lines to anyone
  replaying them by hand to debug a review, blocked by the forge-the-report rule while
  doing the opposite of forging. It is `.work/review.tmp` now. A dead CLI still leaves
  the previous report standing, deliberately: deleting it first would let a rate-limited
  review clear a `CRITICAL`, and the signal that nothing ran is the recipe's exit code.
- **`kit/common/hooks/README.md` described guards that had changed under it** —
  `edit-guard` documented as "always ask, never deny" after two paths started denying,
  and a deny list still advertising bare `sed` while omitting `.git/hooks/`. That file
  ships into consuming repos as the explanation of the layer.

### Added

- **The git hook files are part of the gate layer.** `lefthook uninstall` was covered;
  emptying the files it installs was not — and that is both the cheaper move and the
  one git cannot see. `bash-guard` denies `rm`/`sed -i`/redirects aimed at
  `.git/hooks/`, and `edit-guard` denies writing one.
- **`edit-guard` denies what has no legitimate hand-edit.** It was an ask-only guard,
  so `Write` to `.work/review-report.md` escalated while `bash-guard` denied the shell
  spelling of the same act — the hardest rule in the doctrine enforced by the weaker
  half. The report and `.git/hooks/` now deny; the ask list keeps the files whose edit
  is sometimes the task (justfile, workflows, baselines).

### Changed

- **The review prompt's sha instruction moved out of the shared contract block.** The
  headless reviewer has no shell and is handed `{{sha}}`; the subagent runs
  `git rev-parse HEAD` itself. Keeping both inside the block would have made the two
  copies drift, which is the one thing `registry.test.mjs` exists to prevent — so the
  sourcing is per-variant and the block stays byte-identical.

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
