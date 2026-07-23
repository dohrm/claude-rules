# Claude Rules — Project Instructions

> For project vision and goals, see @README.md.

This repository is a shared library of reusable coding-agent assets, installed
into consuming repos via the npx installer (`bin/cli.mjs`, driven by
`registry.json`) — shadcn-style: copy, own, pin. Not a submodule.

**Agent-agnostic.** Claude Code is the canonical authoring format; the installer
emits/transforms each asset per target agent via `--agent`
(`claude`|`cursor`|`codex`|`opencode`). Each `registry.json` entry carries a
`kind` (`skill`|`kit`|`rule`|`agent`) that selects the per-agent emitter in
`cli.mjs` (`EMITTERS` table). Skills (`SKILL.md`) and kit are portable as-is;
rules → Cursor `.mdc` or an idempotent `AGENTS.md` block for Codex/opencode;
subagents → `.opencode/agent/` (Cursor/Codex have no file-based subagents). Author
in Claude format only — never hand-maintain the transformed outputs.

## Repository Structure

- `rules/` — prose conventions, **auto-loaded** from `.claude/rules/` (language rules path-scoped via `paths:`; `@import` optional) (durable)
- `kit/` — executable quality gates (lefthook/rustfmt/deny/mutants/CI), copied & adapted per repo (durable)
- `agents/` — thin Claude Code subagent definitions, copied into `.claude/agents/` (perishable — keep minimal)
- `skills/` — Claude Code skills as canonical `<name>/SKILL.md` dirs, copied into `.claude/skills/` (auto-discovered); frontmatter is `name` + `description` (the description drives auto-triggering)
- `guidelines/` — patterns for working with Claude Code
- `registry.json` + `bin/cli.mjs` — the installer (data-driven; the CLI stays dumb)

## Working rules

- Keep the split honest: a new **convention** → `rules/`; a new **check** → `kit/`;
  a repeatable **procedure/methodology** → `skills/` (a `SKILL.md` dir); an **agent**
  only when the work needs its own context/tools (else a skill is lighter); otherwise it's a rule.
- Agents stay thin: they inherit the consuming repo's `CLAUDE.md` (and its imported
  rules), so never restate conventions inside an agent prompt.
- The installer never merges build config — kit wiring is manual and documented.
- Artifacts (rules, agents, docs) are written in English; see `rules/language.md`.
