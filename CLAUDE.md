# Claude Rules — Project Instructions

> For project vision and goals, see @README.md.

This repository is a shared library of reusable coding-agent assets, installed
into consuming repos via the npx installer (`bin/cli.mjs`, driven by
`registry.json`) — shadcn-style: copy, own, pin. Not a submodule.

**Two targets.** Claude Code is the canonical authoring format; the installer
emits/transforms each asset for Cursor via `--agent` (`claude`|`cursor`). Each
`registry.json` entry carries a `kind` (`skill`|`kit`|`rule`|`agent`) that
selects the per-agent emitter in `cli.mjs` (`EMITTERS` table). Skills (`SKILL.md`)
and kit are portable as-is; rules → Cursor `.mdc`. Cursor has no file-based
subagents. Author in Claude format only — never hand-maintain the transformed
outputs.

## Repository Structure

- `rules/` — prose conventions, **auto-loaded** from `.claude/rules/` (language rules path-scoped via `paths:`; `@import` optional) (durable)
- `kit/` — executable quality gates (lefthook/rustfmt/deny/mutants/CI), copied & adapted per repo (durable)
- `agents/` — thin Claude Code subagent definitions, copied into `.claude/agents/` (perishable — keep minimal)
- `skills/` — Claude Code skills as canonical `<name>/SKILL.md` dirs, copied into `.claude/skills/` (auto-discovered); frontmatter is `name` + `description` (the description drives auto-triggering)
- `guidelines/` — patterns for working with Claude Code
- `registry.json` + `bin/cli.mjs` — the installer (data-driven; the CLI stays dumb)
- `test/` — `npm test`: black-box installer tests + asset-tree consistency (node:test, no deps, no network). Runs on every PR. The rust jalon (`test/rust-gates.test.mjs`) skips when the toolchain is missing; the matching CI job installs it and sets `RUST_GATES=1` so a skip cannot pass.
- `eval/` — agent regression harness; calls `claude` and spends tokens, so it is manual (model bumps only)

## Working rules

- Keep the split honest: a new **convention** → `rules/`; a new **check** → `kit/`;
  a repeatable **procedure/methodology** → `skills/` (a `SKILL.md` dir); an **agent**
  only when the work needs its own context/tools (else a skill is lighter); otherwise it's a rule.
- Agents stay thin: they inherit the consuming repo's `CLAUDE.md` (and its imported
  rules), so never restate conventions inside an agent prompt.
- The installer never merges build config — kit wiring is manual and documented.
- Artifacts (rules, agents, docs) are written in English; see `rules/language.md`.
- Adding an asset is not done until `npm test` passes: a new profile must appear in
  `/architect`'s gating table, a new rule/skill/kit dir must be reachable from
  `registry.json`, a skill's frontmatter `name` must equal its directory name.
