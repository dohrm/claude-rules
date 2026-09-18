# Claude/Codex sharing — implementation plan

- **Status**: Ready for review; implementation not started.
- **Intent**: Use Claude Code and Codex on the same repository with consistent
  rules, discoverable module guidance and shared review gates.
- **Decision**: [ADR-0003](../../docs/adr/0003-claude-codex-sharing.md), still Proposed.
- **Contract**: [Agent sharing](../../docs/agent-sharing.md).
- **Baseline**: `e053907`; branch `codex/prompt-discipline-readme-cleanup`.
- **Acceptance boundary**: the maintainer manually accepts and commits ADR-0003
  before implementation. Do not change ADR statuses on their behalf.

## Scope

Deliver a standalone Codex installation and a combined Claude/Codex installation.
Generate short `AGENTS.md` entries from the existing module/profile registry,
including explicit root membership. Keep source assets authored once and preserve
local instructions during install, update and removal.

Do not require subagents, migrate `temper-altern`, retire Cursor, translate native
subagent definitions, change hook permissions, or alter mutation scheduling.
The source checkout's existing untracked `AGENTS.md` is not an installer fixture.

## Evidence and implementation anchors

| Concern | Current anchor | Implication |
|---|---|---|
| Alias expansion | `bin/cli.mjs`: `unpackNames`, `runAdd`; `registry.json`: `aliases` | Expand before routing; the lock already stores elementary profiles |
| Root scope | `prefixesFor`, `scopeGlobs`, `ROOT_FORBID` | Unassigned profiles are global; `.` must not become a glob prefix |
| Shared documents | `SHARED_TREE_GLOB` | Shared `docs/` rules must remain discoverable at root |
| Asset outputs | `EMITTERS`, `emitSkill`, `destsFor` | Resolve assets by registry entry, not profile or alias directory guesses |
| Lifecycle | `install`, `remove`, `writeLock`, `purgeRetired` | Current cleanup deletes the proposed Codex rule tree |
| Generated configuration | `genDirsBlock`, `genClaudeMd`, `init` | Explicit root membership affects more than Codex output |
| Inspection | `RULE_TREE`, `installedRules`, `budget`, `doctor`, `auditGateLayer` | Add Codex without claiming native dynamic loading or nonexistent hooks |
| Existing proof | `test/cli.test.mjs`: aliases, roots, legacy cleanup, additive installs | Extend black-box behavior tests, retaining Claude/Cursor coverage |

## Target behavior example

Inputs such as `add rust-api cqrs --root apps/api` resolve to elementary profiles.
For a representative combined installation, normalized membership is:

```json
{
  ".": ["agent", "testing", "cicd", "product", "devstack"],
  "apps/api": ["rust", "hexagonal", "api", "backend", "cqrs"],
  "apps/web": ["ts-web", "react", "portal-flat", "portal-http"],
  "apps/mobile": ["react"]
}
```

This is a fixture, not a new default profile bundle. Shared registry entries are
also referenced at root without adding them as fictitious profiles.

```text
AGENTS.md                     common guidance + discovery + module map
apps/api/AGENTS.md             API module's rule references and conditions
apps/web/AGENTS.md             web module's rule references and conditions
apps/mobile/AGENTS.md          mobile module's rule references and conditions
.agents/rules/                generated Codex rule assets
.agents/skills/               Codex/Cursor skill outputs
.claude/skills/               Claude copies from the same source
.dev/kit/                    one executable kit
```

## 1. Normalize aliases and module membership

**Depends on**: manual ADR acceptance.

- Reuse one alias resolver for CLI input and normalization of legacy/hand-edited
  locks. Validate unknown names and cycles; deduplicate expanded profiles.
- Derive `modules["."]` as the complement of non-root assignments. Preserve the
  current additive semantics: adding a scoped profile without a root retains its
  bindings; adding another non-root binding extends them.
- Allow `agent`/`product` in `.` while keeping their non-root prohibition. Reject
  contradictory explicit root membership rather than silently widening scope.
- Normalize repository-relative module paths and reject escapes. Adapt glob
  scoping, generated directory variables, module tables and doctor to `.`.
- Define one effective module/asset mapping for both emission and diagnostics.
  Apply profile levels and existing language filtering before listing assets.

**Acceptance**: `rust-api` and its expanded profile list produce equivalent
outputs; old locks normalize without changing effective globs or kit directories.
Repeated normalization is stable. Shared profiles retain every module binding.

## 2. Implement safe Codex installation and lifecycle

**Depends on**: 1.

- Add Codex as an explicit target, preserving current defaults until step 4.
  Emit shared skills once per destination and one kit per installation.
- Generate Codex rule files and root/module instruction blocks using the contract.
  Root discovery requires reading applicable ancestor instructions when entering
  a directory, including during review and work spanning modules.
- Reference shared/unscoped rules at root, module rules locally, and shared docs
  conditions at root even when their profile is module-bound. Deduplicate reads.
- Remove Codex paths from unconditional retired cleanup. Inventory owned Codex
  files/blocks in the lock; preserve unknown adjacent files and all outside text.
- Preflight all affected destinations before mutation: markers, ownership,
  conflicting existing files, symlinked files/ancestors and paths outside the repo.
  Stage source assets before replacement so a fetch or validation failure leaves
  the previous installation usable.
- Support adoption of identical existing assets and a single valid legacy block;
  diagnose conflicting manual installations without overwriting them.
- On profile removal, calculate remaining ownership before deletion. Refresh every
  affected entry point; clean obsolete owned module blocks while retaining user
  content and assets needed by remaining profiles/targets.

**Acceptance**: Codex alone works without `.claude`; combined installs have
consistent skills. Updates are idempotent. Malformed markers and conflicting
destinations cause no install mutation. Partial/full removal preserves user/Pane
text and unrelated files. Existing Claude/Cursor installations stay functional.

## 3. Make routing and context costs inspectable

**Depends on**: 2.

- Extend `doctor` to verify root/module blocks, referenced assets, effective
  membership and overrides that shadow generated instructions.
- Extend `budget --agent codex <path>` to distinguish instruction entry files,
  unconditional rule reads, conditional rule reads and skill descriptions.
  Deduplicate referenced files; explain that these are requested reads, not
  measurements of actual loaded context or native glob activation.
- Report the documented instruction limit as a diagnostic, accounting for the
  generated ancestor chain while acknowledging unknown global/configured inputs.
- Do not claim Codex-specific harness hooks were installed; retain shared git
  gate checks and the existing Codex review runner.

**Acceptance**: broken links, stale module references and shadowing overrides
have useful diagnostics; API and web examples show their distinct requested rules.

## 4. Enable the default and document migration

**Depends on**: 3.

- Separate supported targets from new-install defaults: Claude/Codex by default,
  Cursor explicit. Preserve the target set on existing-lock add/update operations.
- Update interactive prompts, CLI help, `init` messages and onboarding examples.
- Update `README.md`, `docs/reference.md`, `CLAUDE.md`, instruction-layout guidance,
  relevant migration/onboarding skills and `CHANGELOG.md`. Explain profile aliases,
  explicit root scope, generated ownership and progressive discovery accurately.
- Keep commands that add Codex to an existing installation explicit. Do not use
  `remove` examples to imply a target-removal feature the CLI does not provide.

**Acceptance**: documented commands execute in fixtures; fresh defaults select
Claude/Codex while old Claude/Cursor locks keep their agents. Documentation no
longer describes active Codex outputs as retired.

## Final verification

Run `npm test` and the strict ADR/document checks. Installer scenarios must include
fresh single/all-target installs; aliases; root-only, nested and sibling modules;
one profile in multiple modules; shared docs; legacy locks; adoption conflicts;
symlink/path escapes; partial removal; full uninstall; and repeated updates.

Use a disposable monorepo for a behavioral check with the actual Codex runtime:
start once at root and once in the API module, request a task spanning modules,
and inspect the instruction files the agent reads before editing/reviewing. Check
that API guidance is discovered without imposing API rules on web code. Record
runtime version and observations separately from static installer test results.
No live consumer migration and no claim of guaranteed model adherence.

## Ready-to-deliver criteria

- Installation, update and removal implement the module contract without data loss.
- Both tools use the same authored assets; root and module entry points are usable.
- Existing consumers retain their chosen targets and effective scopes.
- Tests pass; behavioral evidence or any unavailable runtime check is stated.
- Human-only ADR acceptance, document gates and mutation policy are unchanged.
