---
title: "CLAUDE.md Hierarchy"
---

## Core Principle

Keep `CLAUDE.md` light (< 200 lines). Adherence to rules decreases as file size grows.
Split concerns across files and load them via the `@path/to/file.md` import syntax.

## File Roles

| File | Audience | Content |
|------|----------|---------|
| `README.md` | Humans + Claude (via `@README.md`) | Project vision, goals, product direction |
| `CLAUDE.md` | Claude only | Technical context, stack, workflows, `@` references to rules |
| `.claude/rules/*.md` | Claude only (auto-discovered) | Specific rules: style, quality gates, language, security, … |

## Loading Mechanics

### Eager (every session)

Loaded at launch, token cost paid on every conversation:

- Ancestor `CLAUDE.md` files (root and above the working directory)
- `.claude/rules/*.md` files **without** `paths` frontmatter
- All files `@`-imported by any of the above (up to 5 levels deep)

### On-demand

Loaded only when relevant, token cost paid only when needed:

- **Subdirectory `CLAUDE.md`** — loaded when Claude reads a file in that directory
- **Path-scoped rules** — `.claude/rules/*.md` files with `paths` frontmatter, loaded when Claude opens a matching file

```markdown
---
paths:
  - "src/**/*.rs"
---
# This rule only loads when Claude opens a .rs file
```

> **Implication:** every rule in `.claude/rules/` without a `paths` filter is always in context.
> Use path-scoped rules or subdirectory `CLAUDE.md` files to limit scope in large projects.

## Hierarchical Loading in Multi-Module Projects

**Recommended structure:**

```
project/
├── CLAUDE.md              # Global: stack, shared rules (@rules/style.md, @README.md, …)
├── README.md              # Product vision
├── .claude/
│   └── rules/
│       ├── code-style.md           # always loaded
│       ├── quality-gates.md        # always loaded
│       └── leptos.md               # path-scoped: only when *.rs files opened
└── workspace-rust/
    └── CLAUDE.md          # on-demand: loaded when Claude works in this directory
```

## Subdirectory CLAUDE.md

Carries both vision and technical rules for the submodule — audience is Claude, not a human onboarding. Keep the vision short (2-3 lines): enough for Claude to understand the *why* behind local constraints.

Example (`workspace-rust/CLAUDE.md`):
```markdown
# Rust Workspace

This module handles real-time audio processing. Latency is a hard constraint — avoid allocations on the hot path.

@../rules/code-style.md
```

## Summary

| Mechanism | When loaded | Token cost |
|-----------|-------------|------------|
| Root / ancestor `CLAUDE.md` | Every session | Always |
| `.claude/rules/*.md` (no paths filter) | Every session | Always |
| `@`-imported files | Every session | Always |
| `.claude/rules/*.md` (with `paths`) | On matching file open | On demand |
| Subdirectory `CLAUDE.md` | On file access in that dir | On demand |

## Rule Precedence

Two axes, and they are independent.

**Depth wins.** Across the directory tree, files are concatenated from the filesystem
root down to the working directory, so the deeper file is read last and overrides the
parent on conflict. Load order, broadest to narrowest: managed policy → user
(`~/.claude/`) → project (`./CLAUDE.md`, `.claude/rules/`) → local
(`CLAUDE.local.md`). User-level rules load before project rules, which is why a
project rule beats a personal one.

**Within a file, later wins.** When a project rule contradicts a rule pulled in by
`@`-import, put the override *after* the import in the same file:

```markdown
<!-- .claude/rules/code-style.md -->
@../claude-rules/rules/rust/code-style.md

## Project Overrides
- Function size hard limit: 80 lines (stricter than the library default)
```

This is the one case where `@`-import still earns its place under the installer
model: the installer copies rules in verbatim, so a repo that wants to *amend* a
shipped rule rather than fork it keeps a thin local file that imports and then
overrides. Everything else needs no import — `.claude/rules/` auto-loads.

Contradictions Claude cannot resolve by depth or order are resolved arbitrarily.
Two rules that disagree is a bug in the rules, not a precedence question.

## AGENTS.md

**Claude Code reads `CLAUDE.md`, not `AGENTS.md`** — not as a fallback when
`CLAUDE.md` is absent, and not in addition to it. A repo with only an `AGENTS.md`
starts every Claude session with no project map at all. The documented bridges are
an `@AGENTS.md` import from `CLAUDE.md`, or a symlink; `/import` (and `/init` under
`CLAUDE_CODE_NEW_INIT=1`) will also copy an `AGENTS.md` in once, as a one-shot.

Do not reach for those bridges in a repo installed for both Claude *and*
Codex/opencode. There, `AGENTS.md` carries an installer-managed block that is those
tools' *copy* of rules Claude already auto-loads from `.claude/rules/` — importing it
pays for the same conventions twice. Keep the channels separate: `CLAUDE.md` is the
project map, the managed block is the other tools' rule delivery.

## Other

- `@path/to/file.md` imports are expanded at launch, recursively, up to 4 hops deep
- In large monorepos, use `claudeMdExcludes` in `.claude/settings.local.json` to skip irrelevant CLAUDE.md files

## Sources

- [Memory & CLAUDE.md — Claude Code Docs](https://code.claude.com/docs/en/memory) — including the [AGENTS.md](https://code.claude.com/docs/en/memory#agents-md) section this page cites
- [Settings — Claude Code Docs](https://docs.anthropic.com/en/docs/claude-code/settings)
