# claude-rules

A shared library of **coding-agent assets** — rules, agents, skills, and a
quality-gate kit — built across projects and installed into any repo the way
shadcn installs components: **copy, own, pin**. No runtime dependency, no
submodule to babysit.

**Agent-agnostic** (despite the name): Claude Code is the canonical authoring
format, and the installer emits/transforms each asset for **Cursor, Codex and
opencode** too (`--agent`). Skills (the open `SKILL.md` standard) and the kit are
portable as-is; rules and agents are transformed per target. See
[Multi-agent targets](#multi-agent-targets) for the portability map.

## Three asset types (different half-life, different handling)

| Type | What | Half-life | How it's used |
|------|------|-----------|---------------|
| **rules/** | prose conventions (style, architecture, quality gates) per language | years | **auto-loaded** from `.claude/rules/`; language rules are path-scoped via `paths:` (load when matching files are read) |
| **kit/** | executable quality gates (lefthook, rustfmt, deny, mutants, CI) | years | config the *tools* run — copied to the repo, adapted per repo |
| **agents/** | Claude Code subagent definitions | ~one model release | copied into `.claude/agents/` — kept thin (they inherit the repo's rules via CLAUDE.md) |
| **skills/** | Claude Code skills (`<name>/SKILL.md`) — reusable procedures & methodologies | varies (a *methodology* is durable; a *transformation* tracks the codebase) | copied into `.claude/skills/` (auto-discovered); invoked as `/name` or auto-triggered via the `description:` |

The load-bearing, durable value is in **rules + kit** (deterministic, model-independent).
Agents are the thin, perishable layer — few, and they reference the rules rather
than restating them.

## Install (npx — cross-platform, pinned)

```bash
# in your repo, from its root:
npx github:dohrm/claude-rules add rust            # or: ts, go — language baselines, combine them
npx github:dohrm/claude-rules add rust hexagonal api backend   # a Rust backend (architecture patterns are opt-in, gated by shape)
npx github:dohrm/claude-rules add ts portal-flat   # a React frontend
npx github:dohrm/claude-rules add investigate      # opt-in skill: 4-phase debug methodology
npx github:dohrm/claude-rules add product          # opt-in product-lifecycle skills (interview→prd→architect+design-system→plan, diagram)
npx github:dohrm/claude-rules add rust ts --ref v0.1.0
npx github:dohrm/claude-rules add rust --agent claude   # narrow to one agent (default: ALL agents)
npx github:dohrm/claude-rules update --ref v0.2.0 # re-install pinned profiles+agents at a new ref
npx github:dohrm/claude-rules list                # available & installed
```

`--agent` accepts a comma-separated list (`claude`, `cursor`, `codex`,
`opencode`). **The default is all agents** — producing a single one is a
deliberate `--agent` choice. The chosen set is pinned in `.claude-rules.lock`, so
`update` replays it.

The installer drops each profile's **rules** into `.claude/rules/` (auto-loaded),
**agents** into `.claude/agents/` (auto-discovered), and **kit** into
`.claude/kit/<lang>/`, then pins the ref in `.claude-rules.lock` and prints the
one-time wiring for the kit only. It **never merges your build config**
(lefthook/eslint) — you wire the kit once (see [`kit/README.md`](./kit/README.md)).

Updates are reviewable: re-run `update` at a newer ref and read the `git diff`.

### After install — rules and agents need no wiring

`.claude/rules/` is auto-loaded by Claude Code — **no `@import` needed**. Language
rules carry a `paths:` glob so they load only when you touch matching files
(Rust rules on `**/*.rs`, etc.); cross-cutting rules (autonomy, language) load
every session. Agents in `.claude/agents/` are auto-discovered. Subagents inherit
the project's rules the same way, so a copied agent stays thin and picks up the
conventions without restating them.

(`@import` from a `CLAUDE.md` still works if you want to curate a specific file,
but it is no longer required — dropping a rule in `.claude/rules/` is enough.)

Only the **kit** needs a one-time wiring (merge the lefthook/just snippets, move
the configs into place).

## Multi-agent targets

Claude is the canonical source; each asset is emitted (copied or transformed) per
target agent. Where a format is a shared standard, it's a straight copy; where it
diverges, the installer transforms it.

| Asset | Claude (canonical) | Cursor | Codex | opencode |
|-------|--------------------|--------|-------|----------|
| **skill** | `.claude/skills/` | `.agents/skills/` | `.agents/skills/` | `.opencode/skills/` |
| **kit** | `.claude/kit/` | `.dev/kit/` | `.dev/kit/` | `.dev/kit/` |
| **rule** (path-scoped) | `.claude/rules/` (`paths:`) | `.cursor/rules/*.mdc` (`globs:`) | `.agents/rules/` + ref in `AGENTS.md` | `.agents/rules/` + ref in `AGENTS.md` |
| **rule** (cross-cutting) | `.claude/rules/` | `.cursor/rules/*.mdc` (`alwaysApply`) | inlined in `AGENTS.md` | inlined in `AGENTS.md` |
| **agent** (subagent) | `.claude/agents/` | — (no file subagents) | — (no file subagents) | `.opencode/agent/` |

`skills/` is the open [`SKILL.md` standard](https://www.agensi.io/learn/agent-skills-open-standard)
— read verbatim by 30+ tools — so it's just a copy. `kit/` is tool config
(lefthook/rustfmt/…), agent-independent by construction.

**AGENTS.md** — for Codex/opencode (no per-file path-scoping), rules land in an
installer-owned, idempotent block delimited by `<!-- claude-rules:start -->` …
`<!-- claude-rules:end -->`. Content outside the block is never touched; `update`
rewrites only the block, so the change stays reviewable via `git diff`.
Cross-cutting rules are inlined; path-scoped rules are copied to `.agents/rules/`
and referenced with a "read this file when working on `<glob>`" line — the one
accepted degradation vs Claude/Cursor, which scope automatically.

## Structure

```
claude-rules/
├── registry.json             # drives the installer: profiles → files → dest
├── bin/cli.mjs               # the npx installer (giget-based; dumb, data-driven)
├── rules/                    # auto-loaded prose, path-scoped: language baselines (rust/, go/, ts) + architecture patterns (hexagonal/, cqrs/, portal-flat/, api/, backend/) + agent/

├── kit/                      # executable gates (rust/, ts/, go/) — see kit/README.md
├── agents/                   # thin subagent defs (code-reviewer, code-simplifier)
├── skills/                   # Claude Code skills, canonical <name>/SKILL.md dirs (investigate, product/*, rust-add-domain)
└── guidelines/               # how to work with Claude Code (rules, prompting, CLAUDE.md hierarchy)
```

## Guidelines

- [How to use these rules in a project](./guidelines/how-to-use-rules.md)
- [CLAUDE.md hierarchy in multi-module projects](./guidelines/claude-md-hierarchy.md)
- [Prompting Claude — practical guide](./guidelines/prompting.md)
- [Tooling — Tech Radar](./guidelines/tooling.md)

## Contributing an update

Edit the source here, cut a tag, and consumers pick it up with
`npx github:dohrm/claude-rules update --ref <tag>`. Keep the split honest: a new
*convention* is a **rule**; a new *check* is **kit**; a repeatable *procedure or
methodology* is a **skill** (a `SKILL.md` dir, invoked as `/name`); an **agent**
earns its place only when the work needs its own context/tools — otherwise a skill
in the current context is lighter. If it's neither work nor procedure, it's a rule.
