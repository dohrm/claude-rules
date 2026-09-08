# ADR-0001: Emission targets are Claude Code and Cursor, and nothing else

- **Status**: Proposed
- **Date**: 2026-09-08

## Context

`bin/cli.mjs` declares `KNOWN_AGENTS = ['claude', 'cursor']` and
`RETIRED_AGENTS = ['antigravity', 'codex', 'opencode']` — `--agent codex` is
rejected, and `doctor` reports leftover trees from those targets as drift. The
prose has drifted the other way: the library is described as multi-agent, which
reads as an open-ended list.

The distinction is not cosmetic. Every routing decision in this library optimises
one specific capability: **path-scoped rule loading**. Claude reads `paths:` from
`.claude/rules/`; the Cursor emitter renames it to `globs:` and falls back to
`alwaysApply: true` when a rule carries none. Tools without path scoping —
Windsurf, Copilot, Aider — would import the whole corpus on every turn, which
inverts the purpose of narrowing a glob. A rule set tuned for those tools would
need different globs, or none.

## Decision

We will treat **Claude Code and Cursor as the only emission targets**, and say so
in `README.md` and `CLAUDE.md` rather than implying a broader list.

- `KNOWN_AGENTS` stays `['claude', 'cursor']`; adding a target is a new ADR, not a
  patch.
- Path scoping is the contract a target must support to be added. A target without
  it needs its own glob strategy decided first.
- `skills/` remains portable by construction — it is the open `SKILL.md` standard,
  read verbatim by other tools. That portability is a property of the format, not
  a support commitment, and it is not path-scoped.
- `kit/` remains agent-independent: executable gates, copied byte-identical.

## Consequences

Context-budget work can optimise Claude/Cursor semantics without hedging for tools
that cannot express a glob. The cost is that a user on another tool gets skills and
the kit but no rule routing, and the docs now say that plainly instead of leaving
them to discover it.

Re-adding Codex or OpenCode later means an `AGENTS.md` adapter and a decision on
whether path scoping is reproducible there — a new ADR, superseding this one.

## Alternatives considered

- **Re-add Codex/OpenCode as targets** — needs an `AGENTS.md` adapter and a glob
  strategy for a tool that has none; it would block the routing work behind an
  unbuilt emitter.
- **Declare them best-effort, no path-scoping guarantee** — honest, but it keeps
  three half-supported emitters in `cli.mjs` for no measured user.
- **Leave the prose vague** — the status quo; it is what let a governance question
  surface as a code-review blocker instead of a decision.
