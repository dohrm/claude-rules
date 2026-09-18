# ADR-0003: Share source assets across Claude Code and Codex with explicit routing limits

- **Status**: Accepted
- **Date**: 2026-09-17

## Context

The maintainer uses Claude Code and Codex together for implementation and review.
The installer rejects Codex, while the kit already supports its review CLI.
Consumers maintain their own bridge; updates purge `.agents/rules` and the old
managed `AGENTS.md` block. The earlier two-target policy remains
[Proposed](0001-emission-targets-claude-and-cursor.md).

Codex documents [directory-based instructions](https://learn.chatgpt.com/docs/agent-configuration/agents-md)
and [discovery of `.agents/skills`](https://learn.chatgpt.com/docs/build-skills).
Neither establishes Claude-style automatic loading of rules by file glob.
Supporting Codex therefore requires an honest routing contract, not a claim of
equivalent runtime behavior.

## Decision

We will support Claude Code and Codex together, using one authored corpus and
target-specific outputs.

- New installations default to `claude,codex`; Cursor remains an explicit option.
  Existing locks retain their targets unless the user explicitly adds Codex.
- Skills come from the same source: `.agents/skills` for Codex/Cursor and generated
  copies in `.claude/skills` for Claude. No symlinks or separately authored variants.
- Resolve aliases through the registry into elementary profiles before routing.
  The lock's `modules` is the routing source; `"."` makes its existing fallback
  root scope explicit. Root guidance applies to descendants.
- Codex rules live in `.agents/rules`. Short managed blocks in root and module
  `AGENTS.md` files link to applicable rules. The root lists modules and instructs
  discovery of applicable ancestor guidance before edits or review. Reading rules
  is an agent obligation, not a runtime guarantee of glob-triggered loading.
- Preserve all text outside the managed block, including Pane guidance. Reject
  ambiguous ownership or malformed markers before changing files.
- Keep one `.dev/kit`; retain manual ADR acceptance and existing gates. Native
  subagent conversion and per-user configuration changes are outside this work.

The [implementation proposal](../agent-sharing.md) specifies migration and checks.

## Consequences

Both tools receive the same conventions without maintaining two prompt libraries.
Generated copies still require updating from this library; consumer edits can
diverge. Codex rule selection depends on instruction following. `budget` must
separate startup guidance from requested rule reads, and `doctor` must not claim
to prove that a model loaded a rule. Oversized or overridden instructions need
visible diagnostics. Existing Cursor installations continue to work.

This proposal is not permission to accept ADRs automatically. Implementation of
this target policy waits for the maintainer's manual status change and commit.

## Alternatives considered

- Keep the consumer bridge manual: preserves the installer, but updates remain unsafe for that bridge.
- Inline every rule into `AGENTS.md`: simpler, but loads unrelated conventions and risks truncation.
- Generate nested files without discovery guidance: root sessions have no explicit instruction to find module guidance.
- Share installed skills through symlinks: avoids duplicate bytes, but complicates portability and migration of existing directories.
