# claude-rules

A shared library of coding-agent assets — rules, skills, agents, a quality-gate
kit — installed into consuming repos shadcn-style: copy, own, pin.

## Language

### Installer

**Profile**:
A named bundle of rules/kit/skill entries in `registry.json` that `add`/`remove`
installs or removes together (e.g. `rust`, `hexagonal`, `product`).
_Avoid_: package, plugin

**Level**:
`rules` or `gates` — whether a profile installs prose only, or prose plus the
enforced kit. Recorded per profile in the lock.
_Avoid_: tier, mode

**Root**:
The `--root <dir>` anchor point for a profile in a monorepo — the directory its
rules/kit get copied into and path-scoped to.
_Avoid_: path, location

**Module**:
A named install location in the lock (e.g. `deploy`, `apps/api`) mapping to the
profiles anchored there via `--root` — how a monorepo's lock remembers where
each profile lives.
_Avoid_: root (root is the flag/directory; a module is the lock's record of it)

**Lock** (`.claude-rules.lock`):
The record of what's installed — profiles, agents, modules, levels — that
`update` replays at a new ref.
_Avoid_: manifest, config

**Forge**:
The git hosting platform running CI — GitHub or Gitea. The pipeline doctrine is
forge-agnostic on purpose.
_Avoid_: platform, CI provider

### Rules, skills, agents

**Rule**:
A prose convention under `rules/`, auto-loaded into `.claude/rules/`, optionally
path-scoped via its `paths:` frontmatter.
_Avoid_: guideline, doc

**Skill**:
A `SKILL.md`-defined procedure, invoked as `/<name>`, auto-triggered by its
`description` frontmatter.
_Avoid_: command, workflow, prompt

**Agent**:
A thin Claude Code subagent definition under `agents/`, inheriting the
consuming repo's `CLAUDE.md` rather than restating conventions.
_Avoid_: subagent (used loosely elsewhere; the shipped artifact is an agent)

### Kit & gates

**Kit**:
The executable quality-gate layer — justfile recipes, lefthook, CI snippets —
copied per repo at `--level gates`.
_Avoid_: tooling

**Gate**:
A check that exits green/red on the whole tree (`just check`). The sole
authority on code correctness — never on a decision (`agent/decisions.md`).
_Avoid_: check (the recipe name), validation

**Tier**:
One of the three depths of enforcement: Tier 1 (lint/format), Tier 2
(typecheck/tests/contracts), Tier 3 (mutation/coverage ratchet — run before
push, never in a hook or `check`).
_Avoid_: level, stage

**Witness** (crate/package):
The reference fixture per language that proves a gate script actually catches
what it claims to — exercised locally, re-run by CI as the same proof.
_Avoid_: fixture, sample

**Jalon**:
A language-specific test file (e.g. `test/rust-gates.test.mjs`) that skips when
its toolchain is absent; CI makes the skip non-passing by installing the
toolchain and setting its `_GATES=1` flag.
_Avoid_: milestone (false-friend translation), checkpoint

### Product chain

**Capability**:
One unit of the PRD — an actor, the job it does for them, its status, and
where its User Stories live (`docs/prd/NN-<slug>.md`).
_Avoid_: feature, epic, milestone (considered and rejected — see below)

**Sprint**:
One vertical slice inside a capability's `.work/<slug>/PLAN.md`, cut by
`/plan`, executed by `/tasks` + `/loop-setup`.
_Avoid_: phase (the retired, project-wide term this replaced)

**ADR**:
A decision record under `docs/adr/`. `Proposed` by an agent; `Accepted` /
`Rejected` / `Superseded` / `Deprecated` only by a human, in a commit
(`agent/decisions.md`).
_Avoid_: RFC, design doc

## Flagged ambiguities

- **"milestone"** was considered for the PRD's unit of scope and rejected in
  favor of **capability**. In this repo's language, a milestone properly names
  a goal to reach within a given timeframe or release — a different, narrower
  concept this repo doesn't model yet. A capability is a general product
  feature; don't use "milestone" as a synonym for it.
