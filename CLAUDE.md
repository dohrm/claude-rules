# Claude Rules — Project Instructions

> For project vision and goals, see @README.md.

This repository is a shared library of reusable coding-agent assets, installed
into consuming repos via the npx installer (`bin/cli.mjs`, driven by
`registry.json`) — shadcn-style: copy, own, pin. Not a submodule.

**Claude Code and Codex by default; Cursor optional** ([ADR-0003](docs/adr/0003-claude-codex-sharing.md)).
Author rules and skills once in the existing Markdown format. Registry entries
select emitters by `kind` (`skill`|`kit`|`rule`|`agent`). Claude receives native
rules, Cursor receives `.mdc`, and Codex receives `.agents/rules` with root/module
`AGENTS.md` links requesting progressive reads. Do not claim native dynamic
Codex glob loading. Shared skills live in `.agents/skills`, with identical Claude
copies; the kit has one `.dev/kit` destination. Native agent definitions are
emitted only for Claude in this installer. Never hand-maintain generated outputs.
See [the sharing contract](docs/agent-sharing.md) for alias, scope and ownership rules.

## Repository Structure

- `rules/` — prose conventions, **auto-loaded** from `.claude/rules/` (language rules path-scoped via `paths:`; `@import` optional) (durable)
- `kit/` — executable quality gates (lefthook/rustfmt/deny/mutants/CI), copied & adapted per repo (durable)
- `agents/` — thin Claude Code subagent definitions, copied into `.claude/agents/` (perishable — keep minimal)
- `skills/` — Claude Code skills as canonical `<name>/SKILL.md` dirs, copied into `.claude/skills/` (auto-discovered); frontmatter is `name` + `description` (the description drives auto-triggering)
- `guidelines/` — patterns for working with Claude Code
- `registry.json` + `bin/cli.mjs` + `bin/codex.mjs` — the installer (data-driven; the CLI stays dumb)
- `test/` — `npm test`: black-box installer tests + asset-tree consistency (node:test, no deps, no network). Runs on every PR. Jalons (`test/rust-gates.test.mjs`, `test/python-gates.test.mjs`, `test/go-gates.test.mjs`, `test/ts-gates.test.mjs`, `test/godot-gates.test.mjs`, `test/devstack-gates.test.mjs`) skip when their toolchain is missing; the matching CI jobs install it and set `RUST_GATES=1` / `PYTHON_GATES=1` / `GO_GATES=1` / `TS_GATES=1` / `GODOT_GATES=1` / `DEVSTACK_GATES=1` so a skip cannot pass. `devstack-gates` is the odd one — `kit/devstack` gates nothing, but its two load-bearing claims (a quiet service's log FILE is empty while running; two work trees must not share a control socket) were found by hand and would otherwise never be replayed.
- `eval/` — agent regression harness; calls `claude` and spends tokens, so it is manual (model bumps only)

## Working rules

- Keep the split honest: a new **convention** → `rules/`; a new **check** → `kit/`;
  a repeatable **procedure/methodology** → `skills/` (a `SKILL.md` dir); an **agent**
  only when the work needs its own context/tools (else a skill is lighter); otherwise it's a rule.
- Agents stay thin: they inherit the consuming repo's `CLAUDE.md` (and its imported
  rules), so never restate conventions inside an agent prompt.
- The installer never merges build config — kit wiring is manual and documented.
- Artifacts (rules, agents, docs) are written in English; see `rules/common/language.md`.
- Adding an asset is not done until `npm test` passes: a new profile must appear in
  `/architect`'s gating table, a new rule/skill/kit dir must be reachable from
  `registry.json`, a skill's frontmatter `name` must equal its directory name.
