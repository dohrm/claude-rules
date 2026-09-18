# Claude Code and Codex sharing — implementation proposal

Pending manual acceptance of [ADR-0003](adr/0003-claude-codex-sharing.md).
This describes intended behavior; the current CLI still supports only Claude and
Cursor. No consuming repository has been migrated.

## User-facing behavior

For a new installation, the proposed default is Claude and Codex. Explicit
`--agent claude`, `--agent codex`, `--agent cursor` and comma-separated selections
remain available. Interactive installation displays that choice plainly.

An existing lock is authoritative: `add` and `update` do not silently add Codex or
remove Cursor. Selecting Codex explicitly extends the installed set. Removing a
profile preserves files required by any remaining profile or target.

| Asset | Claude | Codex | Cursor, optional |
|---|---|---|---|
| Skills | `.claude/skills/<name>` | `.agents/skills/<name>` | Same shared directory |
| Rules | `.claude/rules/<profile>` | `.agents/rules/<profile>` | `.cursor/rules/<profile>` |
| Instruction entry | Existing `CLAUDE.md` behavior | Managed blocks in root and module `AGENTS.md` | Existing native rule metadata |
| Executable kit | `.dev/kit` | Same directory | Same directory |
| Native agent definitions | Existing `.claude/agents` | Not emitted in this change | Existing behavior |

The library's `skills/` and `rules/` remain the authoring source. The two skill
destinations are outputs of one installation, not two manually synchronized
libraries. Claude-only and Codex-only installations must both be self-contained.

## Module and alias contract

Resolve alias names through `registry.aliases` before interpreting membership.
`rust-api`, for example, expands to `rust`, `hexagonal`, `api`, `backend`; none of
those names implies a destination directory. Resolve actual assets via registry
entries and `kind`, then deduplicate by source/destination.

The current CLI already expands `add` and `remove` arguments with `unpackNames()`;
its lock stores elementary profiles. Reuse that resolver at lock normalization
boundaries as well, with validation for unknown names and alias cycles.

`modules["."]` represents the existing root fallback: installed profiles with no
non-root assignment. Shared registry assets also belong at the root without
inventing a `common` profile. Keep `agent` and `product` at root. A profile can
belong to several non-root modules; no independent root-and-child assignment is
introduced in this change. The root list is recomputed after membership changes,
so an explicit module binding narrows a previously unbound profile as it does
now. Adding an already scoped profile without `--root` retains its bindings.

Old locks derive root membership from that same complement. A declared root list
must agree with the effective memberships; diagnose conflicting hand edits rather
than silently broadening scope. The root is unprefixed, never `./**/*.rs`.

## Codex routing

Keep rules in canonical Markdown form and reuse the existing module and language
filtering. Emit a short managed block in root `AGENTS.md` and each declared
non-root module's `AGENTS.md`. Each block points to actual rule assets, grouping
unconditional reads and conditional reads with their effective globs. No whole
rule corpus is inlined.

Root guidance contains shared assets, root-profile references and the module map.
It instructs the agent to read applicable instruction files along the ancestor
chain before editing or reviewing, and to repeat discovery when scope expands.
Read applicable `AGENTS.override.md` instead of `AGENTS.md` where present, warn
when it shadows an emitted block, and preserve user configuration. Read necessary
parent guidance before creating a new directory or document. Delegation is optional;
when used, carry this discovery obligation into the delegated task.

Module guidance lists the rules associated with that module's expanded profiles.
A shared profile such as `react` can be referenced from multiple modules without
duplicating its rule files or dropping another module's effective globs.

Preserve the current scope exceptions: rules without `paths` remain global;
shared `docs/` globs remain reachable from root even if their owning profile has a
module binding. Expose only the relevant conditions at each entry point. Profile
membership is not permission to apply every convention to every file.

Reference paths are relative to each instruction file, so a backend entry might
link to `../../.agents/rules/rust/code-style.md`. State that effective globs are
repository-root-relative. A root-started task must discover module rules without
restarting in that module; a module-started task still inherits root guidance.

Do not import all of `CLAUDE.md` into Codex or all of `AGENTS.md` into Claude.
Do not modify global Codex configuration or manufacture command-permission rules.
This is explicit progressive reading, not native file-glob enforcement.

## Safe migration and ownership

The existing `purgeRetired()` removes `.agents/rules` recursively and strips the
historical managed block. That path must leave unconditional retirement cleanup.

Before writes, inspect destination ownership, marker structure and file types
for every root/module instruction file and asset. Validate module paths stay
inside the repository, including symlinked ancestor directories.
Use the historical markers only when there is exactly one well-formed pair.
Missing markers allow an append to an ordinary existing `AGENTS.md`; unmatched,
reversed or duplicate markers require a diagnostic and no mutation. Preserve the
bytes outside the block, including other tools' managed sections. Do not follow
symlinked instruction files or overwrite a conflicting unmanaged destination.

Record the Codex-owned emitted file paths in the lock. Refresh and remove only
owned files; retain unknown files alongside them. On first adoption of existing
untracked destinations, adopt byte-identical files only; conflicting contents
must be reconciled explicitly. Do not restore destructive legacy cleanup for
installations that have not selected Codex.

Regenerate the root/module references after partial profile removal. Full removal deletes the
owned block and files while preserving user instructions and shared assets still
needed by another target. A managed block is never evidence of ownership of the
whole `AGENTS.md` file.

## Diagnostics

- `doctor`: check expected files, index consistency, ownership and malformed
  markers. Detect root/module `AGENTS.override.md` files that can shadow generated entries.
  Explain that local configuration and nested guidance may alter discovery.
- `budget --agent codex`: separately report the root/module instruction
  chain, skill description estimates, and referenced rule bytes requested for the
  supplied path. Distinguish unconditional and conditional reads and deduplicate
  files shared across the chain. No claim to measure actual runtime context.
- Warn when the generated instruction chain approaches or exceeds Codex's documented default
  32 KiB instruction limit. Existing user/global instructions also consume budget;
  a below-limit managed block is not proof against truncation.

## Implementation and verification

The executable work breakdown and acceptance criteria live in
[the plan](../.work/agent-sharing/PLAN.md).

Update the emitter, destination mapping, cleanup, lock handling, interactive
defaults, `init`, `doctor` and `budget` together. Keep the registry's profile
contents unchanged. Update the README, target reference and instruction-layout
guide to distinguish supported behavior from advisory routing.

Black-box installer checks must cover:

- Fresh Claude/Codex, each alone, Cursor alone, and all three together.
- Byte-identical skill outputs and one shared kit; deterministic repeated updates.
- Module-scoped globs, multiple roots, language filtering and unscoped guidance.
- Existing Claude/Cursor locks unchanged until Codex is explicitly selected.
- Pane/user text preservation, malformed markers, conflicting files and symlinks.
- Update and removal preserving unowned files and remaining shared destinations.
- Missing/stale index entries, override diagnostics and honest budget labels.

Run `npm test` after implementation. Separately exercise a disposable monorepo
with Codex to inspect which instructions and rules it actually reads from the
root and a module. Static output checks cannot establish model adherence.

## Deferred

Cursor retirement, dsh support, native Codex subagent conversion, replacing hooks,
mutation scheduling and deployment into `temper-altern` are separate decisions.
