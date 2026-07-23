# claude-rules

A shared library of **Claude Code assets** — rules, agents, and a quality-gate
kit — built across projects and installed into any repo the way shadcn installs
components: **copy, own, pin**. No runtime dependency, no submodule to babysit.

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
npx github:dohrm/claude-rules add rust            # or: ts, go — combine them
npx github:dohrm/claude-rules add investigate      # opt-in skill: 4-phase debug methodology
npx github:dohrm/claude-rules add product          # opt-in product-lifecycle skills (interview→prd→architect+design-system→plan, diagram)
npx github:dohrm/claude-rules add rust ts --ref v0.1.0
npx github:dohrm/claude-rules update --ref v0.2.0 # re-install pinned profiles at a new ref
npx github:dohrm/claude-rules list                # available & installed
```

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

## Structure

```
claude-rules/
├── registry.json             # drives the installer: profiles → files → dest
├── bin/cli.mjs               # the npx installer (giget-based; dumb, data-driven)
├── rules/                    # auto-loaded prose, path-scoped (language.md, rust/, go/, react/, architecture/, …)
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
