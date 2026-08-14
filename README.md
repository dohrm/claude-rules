# claude-rules

A shared library of **coding-agent assets** — rules, skills, subagents and a
quality-gate kit — built across projects and installed into any repo the way
shadcn installs components: **copy, own, pin**. No runtime dependency, no
submodule to babysit.

**Agent-agnostic** (despite the name): Claude Code is the canonical authoring
format, and the installer emits/transforms each asset for **Cursor, Codex and
opencode** too (`--agent`). See [Multi-agent targets](#multi-agent-targets).

Installing profiles does not just drop files — it installs a **way of working**.
That workflow is implicit in the assets, so it is spelled out first.

---

## The workflow these assets encode

```mermaid
flowchart LR
  I["/interview"] --> P["/prd"]
  P --> A["/architect"]
  A --> PM["/pre-mortem"]
  PM -.-> P
  A --> PL["/plan"]
  P --> DS["/design-system"] & EX["/experience"]
  DS & EX --> UP["/ui-prompt"]
  PL --> T["/tasks"]
  T --> B["build<br/>rules + just check"]
  B --> G["gate<br/>hooks + CI"]
  G --> R["release<br/>tag"]
  R --> O["/observability"]
  O --> RB["/runbook"]
  RB --> PMO["/postmortem"]
  PMO -.-> A
  PMO -.-> PL
```

| Phase | Command | Produces | Who decides |
|---|---|---|---|
| **Frame** | `/interview` → `/prd` | `docs/PRD.md` (+ `docs/prd/` once it grows) | human, question by question |
| **Decide** | `/architect` | `docs/ARCHITECTURE.md` + one ADR per decision | agent writes `Proposed`, **human accepts** |
| **Attack it** | `/pre-mortem` | `docs/premortem/<target>-<horizon>.md`, deltas back into PRD/ADRs | human, on each mitigation |
| **Design the surfaces** | `/design-system`, `/experience` → `/ui-prompt` | `docs/DESIGN.md`, `docs/EXPERIENCE.md`, a generator prompt | human |
| **Slice** | `/plan` | `docs/PLAN.md` (+ `docs/plan/` once it grows) | human validates the granularity |
| **Cut one phase** | `/tasks` | `.work/phase-NN-*.md` — anchors + tasks sized to the green boundary (gitignored, dies with the branch) | human validates the cut |
| **Build** | (no command — rules auto-load) | code + tests, `just check` green | **the gate**, not an opinion |
| **Gate** | `/ci-setup` | the pipeline, calling the same `just` recipes | human sets branch protection |
| **Ship** | — | a tag | **human pushes the tag** |
| **Run** | `/observability` | `docs/OBSERVABILITY.md`, SLOs as ADRs, the alert table | human agrees the error budget policy |
| **Survive** | `/runbook`, `/postmortem` | `docs/runbook/*`, `docs/postmortem/*` | human owns each action item |

Nothing forces you through all of it. A library repo installs `rust testing cicd`
and never runs a product skill; a greenfield product starts at `/interview`.

### Two boundaries the whole library is built around

1. **The machine settles correctness.** An agent writes the code *and* its tests,
   runs `just check`, reads the failure, fixes the cause, and only then hands back.
   A green gate is permission; the agent's belief is not (`rules/agent/autonomy.md`).
2. **A human settles decisions.** A green gate is permission for *code*, never for a
   *decision*. Four things an agent proposes and never takes: an **ADR's status**
   (enforced by `adr-check`), the **release tag**, the **error budget policy**, and
   any **acceptance** of scope. Discussing is not accepting.

### Documents grow as units, not as longer files

A PRD and a plan are meant to grow; the *file* is not. Past a threshold each becomes
a directory of append-only units plus a one-screen index — the shape `docs/adr/`
already has (`rules/product/documents.md`, enforced advisorily by `docs-check`). The
thresholds are defaults: a repo moves them in `.docs-budgets.json` at its root, a file
the installer never writes — so an update cannot reset a budget you argued for.

```
docs/
├── PRD.md              # the stable spine + the capability table   (index)
│   └── prd/            # one capability per file                   (units)
├── ARCHITECTURE.md     # stack + boundaries + the decision log     (index)
│   └── adr/            # one decision per file, ~400 words         (units)
├── PLAN.md             # where we are + the phase table            (index)
│   └── plan/           # one phase per file, frozen once shipped   (units)
├── DESIGN.md           EXPERIENCE.md          # visual / behavioral systems
├── OBSERVABILITY.md    # SLIs, SLOs, gaps, alert table             (index)
├── runbook/            # one per failure mode, one screen
├── postmortem/         # one per incident, blameless
└── premortem/          # one register per (target, horizon)
```

---

## Install

```bash
# in your repo, from its root — combine profiles freely:
npx github:dohrm/claude-rules add rust testing cicd hexagonal api backend   # a Rust backend
npx github:dohrm/claude-rules add ts testing cicd portal-flat               # a React frontend
npx github:dohrm/claude-rules add ops k8s incident                          # + running it in production
npx github:dohrm/claude-rules add product                                   # the product-lifecycle skills

npx github:dohrm/claude-rules list                     # available & installed
npx github:dohrm/claude-rules init                     # assemble justfile + lefthook.yml + CLAUDE.md
npx github:dohrm/claude-rules doctor                   # audit the install against this repo (offline)
npx github:dohrm/claude-rules budget src/api/client.ts # what loads for that file, and what it costs
npx github:dohrm/claude-rules add rust --ref v0.1.0    # pin a ref (default: main)
npx github:dohrm/claude-rules add rust --agent claude  # narrow the target agents (default: ALL)
npx github:dohrm/claude-rules add ts portal-flat --module apps/web   # monorepo: anchor to a directory
npx github:dohrm/claude-rules update --ref v0.2.0      # replay the locked profiles+agents at a new ref
npx github:dohrm/claude-rules remove cqrs              # delete a profile's files, update the lock
npx github:dohrm/claude-rules remove all               # full uninstall
```

**Not sure which profiles?** That gating is owned by `/architect`, which maps your
shape (backend / frontend / fullstack / gamedev) to a profile set and prints the
exact command. Install `product` first, or read the table in
[`skills/architect/SKILL.md`](./skills/architect/SKILL.md).

### The profile catalogue

| Group | Profiles | What you get |
|---|---|---|
| **Language baseline** | `rust` `ts` `go` `python` `godot` | style, error handling, logging, quality-gate doctrine + the executable gates |
| **Architecture** | `hexagonal` `cqrs` `react` `portal-flat` `tauri` `api` `backend` | ports/adapters, event sourcing, the React framework gates, flat-domain React portal, Tauri IPC, the HTTP stack, the cross-language backend contracts |
| **Delivery** | `testing` `cicd` | test levels & determinism, contract tests, the mutation ratchet · pipeline & release doctrine, reference workflows, `/ci-setup` |
| **Run** | `ops` `k8s` `incident` | what to emit & what you promise (SLO, error budget), migrations & rollback, `/observability` · the manifest layer · `/runbook` + `/postmortem` |
| **Practice** | `product` `investigate` `loop-setup` | the lifecycle skills + the living-documents rule · a 4-phase debug methodology · framing a self-terminating agent loop |

Every profile also pulls the **shared** assets: the agent rules (autonomy,
guardrails, decisions), the language rule, the two subagents, and `kit/common`.

### What the installer does, and does not

- Rules land in `.claude/rules/` — **auto-loaded, no `@import` needed**. Language
  rules carry a `paths:` glob so they load only when you touch matching files;
  cross-cutting ones load every session.
- Skills land in `.claude/skills/` and subagents in `.claude/agents/` — both
  auto-discovered. Subagents inherit the repo's rules, which is why they stay thin.
- Kit lands in `.claude/kit/` and is the **one thing that needs wiring** (once):
  merge the `just`/lefthook snippets, move the configs into place. The installer
  **never merges your build config** and prints exactly what is left to do — see
  [`kit/README.md`](./kit/README.md). `init` does the assembling for you.
- `init` owns **delimited sections, never whole files**. It creates a `justfile`,
  a `lefthook.yml` and a `CLAUDE.md` when they are absent; when they already exist
  it touches only the `# claude-rules:start … end` block holding the `*_dir`
  variables, which it derives from the lock's `modules`. A `CLAUDE.md` that exists
  is never rewritten — from the moment it is there, it is yours.
- The ref and the agent set are pinned in `.claude-rules.lock`, so `update` replays
  your choices. Updates are reviewable: re-run `update` and read the `git diff`.
- **`add` is additive.** It extends the lock — profiles *and* agents — and re-emits
  everything it now holds, so a second `add` never drops the first one. A bare `add`
  on an existing install keeps its agent set rather than widening to all four; pass
  `--agent` to add a target. Narrowing is `remove`'s job, never a side effect of `add`.
- `remove` is the exact inverse: it deletes what each profile emitted, prunes the
  `AGENTS.md` managed block, and updates the lock. It never touches your
  `justfile`/`lefthook` wiring — delete those recipes yourself. Review with
  `git status` before committing.

### `--module` — the globs a monorepo actually needs

A rule ships an extension-level glob (`**/*.ts`) because the library cannot know
your layout. In a monorepo that is too coarse: `**/*.ts` makes the Fastify rules
and the `backend` error contract load on a React component — roughly **30 % of the
per-file context, spent on guidance that is wrong for that file**.

`--module` anchors the profiles of that invocation to a directory:

```bash
npx github:dohrm/claude-rules add rust hexagonal api backend --module apps/api
npx github:dohrm/claude-rules add ts portal-flat            --module apps/web
npx github:dohrm/claude-rules add testing cicd product      # no --module: repo-wide
```

It lands in the lock, so `update` replays it:

```json
"modules": { "apps/api": ["rust", "hexagonal", "api", "backend"], "apps/web": ["ts", "portal-flat"] }
```

and emission rewrites the globs — `**/*.ts` becomes `apps/api/**/*.ts` for Claude's
`paths:` and Cursor's `globs:` alike. A profile no module claims stays repo-wide, and
a lock with **no** `modules` behaves exactly as before: the installer only rewrites
what it is asked to. Destinations do not change — a rule shared by two modules is
still **one file**, carrying both prefixes.

**Language filtering comes free with it.** A rule declares the languages it is about
in its own `paths:`; if every glob it carries targets a language the lock does not
have, it can never fire and is not emitted at all — `api/go.md` has no business in a
repo with no Go. The filter works at the *rule* level, never at the glob level: a rule
that also covers a locked language keeps its dead globs, because they cost nothing and
start working the day that language arrives.

Because both of those can drop a file the previous install wrote, **rule directories
are cleared before they are rewritten** — they are library-owned and never
hand-edited. `kit/` is deliberately not: it is the copy-and-own surface.

### `doctor` — is the install still true?

An install drifts: a profile is removed by hand, an `update` leaves an orphan, the
repo loses the code a rule covered. None of that is visible — the agent just keeps
loading files nobody can account for. `doctor` audits it, offline and without an
LLM: the lock, the registry, and the files on disk are all it reads, so it belongs
in `just check`.

```bash
npx github:dohrm/claude-rules doctor            # 0 unless something is broken
npx github:dohrm/claude-rules doctor --strict   # warnings fail too
```

Same split as `adr-check` and `docs-check` — it **fails on facts** and **warns on
judgments**:

| | Reported as | Because |
|---|---|---|
| An asset the lock promises is missing on disk | **fail** | the install contradicts its own lock |
| An asset on disk that no locked profile explains | **fail** | agents load it every session and nothing records why |
| The lock names an unknown profile or agent | **fail** | `update` cannot replay it |
| A path-scoped rule whose globs match **no file** here | warn | it can never fire — dead weight, or the repo lost that code |
| Claude locked, but the repo has no `CLAUDE.md` | warn | Claude reads `CLAUDE.md`, **never** `AGENTS.md` — the project map is missing |
| The `AGENTS.md` managed block past 40% of Codex's 32 KiB cap | warn | every KB there is one the repo's own instructions cannot use |

It also prints the **always-on context budget** — the rules with no `paths:`, the
skill descriptions, the size of the `AGENTS.md` block — which is what every session
pays before reading a single line of code.

### `budget` — what does opening this file cost?

The question every context decision turns on, and one nobody could answer without
reading the tree by hand. Same inputs as `doctor`: the emitted rules and their globs.

```bash
npx github:dohrm/claude-rules budget apps/web/src/api/client.ts
npx github:dohrm/claude-rules budget      # no path: the session floor
```

```
Context for apps/web/src/api/client.ts

  always-on rules (4)             9.9 KB  (~2.5k tokens)
      agent/autonomy.md           3.8 KB
      agent/guardrails.md         3.7 KB
      agent/decisions.md          2.1 KB
      common/language.md          0.3 KB
  skills, descriptions (11)       5.9 KB  (~1.5k tokens)
  path-scoped rules (7)          27.1 KB  (~6.9k tokens)
      portal-flat/react.md        5.1 KB    apps/web/**/*.ts
      …
  total                          42.9 KB  (~11.0k tokens)
```

Each path-scoped row names **the glob that matched**, which is what makes a
mis-anchored module visible: a rule firing on `**/*.ts` when you expected
`apps/api/**/*.ts` says so on its own line.

One asymmetry is deliberate: for Codex and opencode, a rule destination exists only
when the profile *has* a path-scoped rule, and `doctor` stages nothing, so it cannot
tell a legitimate absence from a broken one. There it proves
presence-that-should-not-be, never absence-that-should-be.

---

## The commands you end up with

Three different families — worth keeping straight.

**1. The installer** (`npx github:dohrm/claude-rules …`) — `add`, `remove`,
`update`, `list`, `init`. Run from the repo root, occasionally, by a human.

**2. Slash commands in the agent** — every skill is invocable as `/<name>`, and
auto-triggers on its `description:`. What is installed depends on your profiles:

| | |
|---|---|
| `product` | `/interview` `/prd` `/architect` `/design-system` `/experience` `/ui-prompt` `/plan` `/tasks` `/pre-mortem` `/diagram` |
| `cicd` `ops` `incident` | `/ci-setup` `/observability` `/runbook` `/postmortem` |
| `investigate` `loop-setup` `hexagonal` | `/investigate` `/loop-setup` `/rust-add-domain` |

**3. Repo commands — the gates.** One task layer (`justfile`), three callers: the
git hooks, you or the agent, and CI. No command is defined twice.

| Command | Tier | Runs on |
|---|---|---|
| `just <tech>-lint` | 1 — fmt, lint `-D warnings` | pre-commit hook, seconds |
| `just <tech>-check` | 2 — + tests, supply chain, build | pre-push hook, tens of seconds |
| `just check` | 1+2, every tech — **the command an agent closes its loop on** | before every hand-back |
| `just adr-check` | 2 — a decision was taken by a human (+ ADR size/section advisories) | opt-in, with `docs/adr/` |
| `just docs-check` | 2 — an index and its units agree (+ budget advisories) | opt-in, with a PRD/PLAN |
| `just mutate-diff` | 3 — mutation / coverage ratchet, on the merge-base diff | per coherent block, before the push; minutes; never a hook |

Tier 3 is **not** a CI-only tier: `git diff <base>...HEAD` computes the same set on
a laptop that the PR job computes on a runner, so the agent runs it before pushing
and CI re-runs it as a witness. It ships per language (`kit/rust/mutation-ci.yaml`,
`kit/ts/mutation-ci.yaml`, `kit/python/mutation-ci.yaml`, `kit/go/coverage-ci.yaml`) and starts **non-blocking**:
measure a baseline, then ratchet. The Tier 1-2 pipeline is `kit/cicd/ci.snippet.yaml`, whose jobs call the
same `just` recipes — a command CI has and the justfile does not is drift the agent's
local loop cannot see.

---

## Four asset types (different half-life, different handling)

| Type | What | Half-life | How it's used |
|------|------|-----------|---------------|
| **rules/** | prose conventions — style, architecture, testing, delivery, run | years | **auto-loaded** from `.claude/rules/`, path-scoped via `paths:` |
| **kit/** | executable gates — lefthook, just, deny, mutants, CI workflows, doc gates | years | config the *tools* run; copied and wired per repo |
| **skills/** | procedures & methodologies (`<name>/SKILL.md`) | a methodology is durable; a codebase transformation is not | `/name`, or auto-triggered by the `description:` |
| **agents/** | subagent definitions (`code-reviewer`, `code-simplifier`) | ~one model release | auto-discovered from `.claude/agents/`; kept thin |

The load-bearing value is **rules + kit** (deterministic, model-independent).
Agents are the thin, perishable layer — which is why `eval/` exists to detect their
rot on a model bump.

## Multi-agent targets

Claude is the canonical source; each asset is emitted (copied or transformed) per
target agent.

The five targets split into **two families**, and the line between them is the only
thing that matters: does the tool load a rule because a glob matched?

| Asset | Claude (canonical) | Cursor | Antigravity | Codex | opencode |
|-------|--------------------|--------|-------------|-------|----------|
| **skill** | `.claude/skills/` | `.agents/skills/` | `.agents/skills/` | `.agents/skills/` | `.opencode/skills/` |
| **kit** | `.claude/kit/` | `.dev/kit/` | `.dev/kit/` | `.dev/kit/` | `.dev/kit/` |
| **rule** (path-scoped) | `.claude/rules/` (`paths:`) | `.cursor/rules/*.mdc` (`globs:`) | `.agents/rules/*.md` (`globs:`) | `.dev/rules/` + a row in `AGENTS.md` | `.dev/rules/` + a row in `AGENTS.md` |
| **rule** (cross-cutting) | `.claude/rules/` | `.cursor/rules/*.mdc` (`alwaysApply`) | `.agents/rules/*.md` (`alwaysApply`) | inlined in `AGENTS.md` | inlined in `AGENTS.md` |
| **agent** (subagent) | `.claude/agents/` | — (no file subagents) | — (no file subagents) | — (no file subagents) | `.opencode/agent/` |

**Claude, Cursor and Antigravity do.** One file per rule, a glob in the frontmatter,
loaded on demand. Antigravity converged on Cursor's exact format — `description` +
`globs` + `alwaysApply` — so one transform serves both; only the home (`.agents/rules/`)
and the extension (`.md`) differ.

**Codex and opencode do not.** Cross-cutting rules are inlined into an
installer-owned, idempotent block delimited by `<!-- claude-rules:start -->` …
`<!-- claude-rules:end -->` (content outside is never touched, so `update` stays
reviewable in `git diff`). Path-scoped ones are copied to `.dev/rules/` and listed as
"read this file before editing a match" — **an instruction, not a mechanism.** That is
the accepted degradation. The index states it once and imperatively, and groups its
rows by module, so a session working in `apps/api` can skip the rest.

`skills/` is the open [`SKILL.md` standard](https://www.agensi.io/learn/agent-skills-open-standard)
— read verbatim by 30+ tools — so it is a straight copy. `kit/` is tool config,
agent-independent by construction.

### Why `.dev/rules/` and not `.agents/rules/`

`.agents/` is **Antigravity's native directory** — skills, workflows *and* rules. The
skills collision is a happy one: a `SKILL.md` is portable, so one copy serves every
tool that reads the standard. Rules are not: Antigravity reads `.agents/rules/` with
*its* frontmatter, and the codex/opencode copies carry `paths:`, which means nothing
to it. Left there they would be silently mis-read. So they live in `.dev/rules/`,
next to `.dev/kit/`, where nothing claims them.

> **Upgrading an install made before Antigravity was a target:** the codex/opencode
> rule copies moved from `.agents/rules/` to `.dev/rules/`. Run `update`, then delete
> the old `.agents/rules/` — `remove` no longer points there, so it cannot do it for
> you. `doctor` lists exactly which directories to drop.

### Why there is no nested `AGENTS.md`

The obvious idea — `apps/api/AGENTS.md` holding that module's rules — is **not**
implemented, for two reasons that survived the arithmetic:

- **Codex and opencode disagree about what a nested file means.** Codex concatenates
  from the repo root down to your **CWD** (32 KiB cap, one file per directory).
  opencode walks **up** from the CWD and takes the **first** file it finds. So the same
  nested file *extends* the root for one and *replaces* it for the other — silently
  dropping every shared rule under opencode.
- **Inlining a module's rules blows the cap anyway.** For a Rust backend it is ~47 KB
  against Codex's 32 KiB; what would fit is a narrowed index, which the module
  grouping already provides at a fraction of the bytes.

The practical consequence for Codex is a **workflow**, not a file: run it from the
module you are working in (`cd apps/api && codex`), and the root block plus the
module's own group are what it reads.

## Structure

```
claude-rules/
├── registry.json    # drives the installer: profile → source dirs → destinations
├── bin/cli.mjs      # the npx installer (giget-based; dumb by design, data-driven)
├── rules/           # language (rust ts go python godot-csharp) · architecture (hexagonal cqrs
│                    #   portal-flat tauri api backend react) · delivery & run (testing
│                    #   cicd ops k8s) · product · agent
├── kit/             # common (just, adr-check, docs-check) · rust ts go python godot portal-flat · cicd
├── skills/          # canonical <name>/SKILL.md dirs — see the slash-command table above
├── agents/          # thin subagent defs (code-reviewer, code-simplifier)
├── guidelines/      # how to work with Claude Code (rules, prompting, CLAUDE.md hierarchy)
├── test/            # `npm test` — installer + asset-tree gate (node:test, no deps, no network)
└── eval/            # agent regression harness (spends tokens; manual — see eval/README.md)
```

## Verifying the factory itself

```bash
npm test                # installer black-box + asset-tree + prose lint + the kit's doc gates + the eval harness
node eval/run.mjs       # rot detector for the agents AND the skills — spends tokens, run on a model bump
node eval/run.mjs --runner opencode          # …or codex, cursor, antigravity, claude
node eval/run.mjs --cmd "my-agent {prompt}"  # …or any other command (see eval/README.md)
```

`npm test` needs no install: `node:test` only, and the CLI tests run the installer
against the working tree with `--local`. It runs on every PR
([`.github/workflows/ci.yml`](./.github/workflows/ci.yml)); `eval/` is manual
(`workflow_dispatch`). The asset-tree suite is what keeps this README honest — it
fails when a rule, skill or kit directory is unreachable from `registry.json`, when
a skill's frontmatter name drifts from its directory, when `/architect`'s gating
table and the registry disagree, or when a shipped workflow uses an expression
syntax GitHub rejects.

`eval/` covers the two subagents and four skills (`/architect`, `/plan`, `/runbook`,
`/postmortem`), judged where possible by the kit's own gates — `adr-check --strict`
and `docs-check --strict` are the oracle, so the assertion stays deterministic while
the prose varies. It runs against **any agent CLI**, not just Claude — every preset (`claude`, `opencode`, `codex`,
`cursor`, `antigravity`) is verified against the real binary, and anything else goes
through `--cmd`. Given the same skill and fixture, all five produced the same document
structure and none invented a command. The remaining skills are evaluable but not
evaluated; the ones that are pure dialogue or pure judgment deliberately never will be.

## Guidelines

- [How to use these rules in a project](./guidelines/how-to-use-rules.md)
- [CLAUDE.md hierarchy in multi-module projects](./guidelines/claude-md-hierarchy.md)
- [Prompting Claude — practical guide](./guidelines/prompting.md)
- [Tooling — Tech Radar](./guidelines/tooling.md)

## Contributing an update

Edit the source here, run `npm test`, cut a tag; consumers pick it up with
`update --ref <tag>`. Keep the split honest: a new **convention** is a rule; a new
**check** is kit; a repeatable **procedure** is a skill; an **agent** earns its
place only when the work needs its own context or tools — otherwise a skill in the
current context is lighter.

Adding an asset is not done until `npm test` passes: a new profile must appear in
`/architect`'s gating table, every rule/skill/kit directory must be reachable from
`registry.json`, and a skill's frontmatter `name` must equal its directory name.
