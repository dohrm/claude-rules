# Claude Rules — Project Instructions

> For project vision and goals, see @README.md.

This repository is a shared library of reusable Claude Code assets, installed
into consuming repos via the npx installer (`bin/cli.mjs`, driven by
`registry.json`) — shadcn-style: copy, own, pin. Not a submodule.

## Repository Structure

- `rules/` — prose conventions, **auto-loaded** from `.claude/rules/` (language rules path-scoped via `paths:`; `@import` optional) (durable)
- `kit/` — executable quality gates (lefthook/rustfmt/deny/mutants/CI), copied & adapted per repo (durable)
- `agents/` — thin Claude Code subagent definitions, copied into `.claude/agents/` (perishable — keep minimal)
- `skills/` — custom skill definitions
- `guidelines/` — patterns for working with Claude Code
- `registry.json` + `bin/cli.mjs` — the installer (data-driven; the CLI stays dumb)

## Working rules

- Keep the split honest: a new **convention** → `rules/`; a new **check** → `kit/`;
  an **agent** only if it does *work* (review pass, transformation), else it's a rule.
- Agents stay thin: they inherit the consuming repo's `CLAUDE.md` (and its imported
  rules), so never restate conventions inside an agent prompt.
- The installer never merges build config — kit wiring is manual and documented.
- Artifacts (rules, agents, docs) are written in English; see `rules/language.md`.
