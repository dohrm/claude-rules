# ADR-0008: Install from layered sources, last path wins

- **Status**: Proposed
- **Date**: 2026-10-12

## Context

The installer reads one source: `github:${registry.repo}` at a pinned ref, fetched
with `giget`. Two needs do not fit that model.

- **Private, team-wide assets.** A team using the library on many repos has rules,
  skills and kit pieces that are company-specific and must not be published. Today
  they are copied by hand into each repo and drift.
- **Local customisation.** A repo that edits an installed rule (e.g. `language.md`)
  loses the edit on the next `update`: Claude copies are overwritten without any
  check (only Codex files carry a hash in the lock). "Copy, own, pin" has no place
  where a repo's own version survives an update.

Both are the same operation: a later layer replaces some files of an earlier one.
The team's private repositories live on Gitea, not GitHub.

## Decision

We will install from an **ordered list of sources**, merge them into one source
tree by repo-relative path (the last source wins), then run the existing emitters
on the merged tree.

- **Sources.** The lock replaces `repo` + `ref` with `sources`, an ordered list of
  `{ name, url, ref }`. The first entry is this library (`core`). `url` is a
  `github:owner/repo` shorthand or any git URL (SSH or HTTPS, any host).
  ```json
  "sources": [
    { "name": "core",     "url": "github:dohrm/claude-rules",               "ref": "v1.4.0" },
    { "name": "horwedge", "url": "git@gitea.example:horwedge/agent-rules.git", "ref": "v0.3.0" }
  ]
  ```
- **Fetch with `git`.** Each source is a shallow clone at its ref. Authentication is
  the user's git credentials (SSH keys, credential helper); the installer never
  stores or asks for a token. `giget` is removed.
- **Each source has its own `registry.json`.** Registries merge in source order:
  a profile name seen again appends its entries; aliases and `retired` merge, the
  later source winning on the same key. A source may declare profiles only it
  defines.
- **Merge before emitting.** Files are overlaid on a staged tree, in source order.
  Claude, Codex and Cursor emitters read that tree and do not know about sources.
  An override is never applied to emitted files.
- **Unit of override.** A file for `rules/`, `agents/` and `kit/`; a whole directory
  for a skill (`skills/<name>/`). A later skill directory replaces the earlier one
  entirely, so a skill is never half core, half overlay.
- **Removal.** A source registry may list `exclude` paths (files or skill
  directories). They are removed from the merged tree, and the emitters' cleanup
  deletes their installed copies.
- **Project layer.** `.dev/overrides/`, if present, is the last layer. It mirrors
  the source tree layout (`.dev/overrides/rules/common/language.md`), has no ref,
  and is never written by the installer. This is where a repo owns its changes.
- **Overrides are visible.** For each path a later layer replaces, the lock records
  `{ path, by, over, baseHash }` (`baseHash` = hash of the replaced file at install
  time). `add` and `update` print every override. When `update` finds the replaced
  file changed upstream, it warns
  `⚠ rules/common/language.md changed in core (overridden by horwedge)`;
  with `--strict` it fails.
- **Compatibility.** A lock without `sources` is read as
  `[{ name: "core", url: "github:" + repo, ref }]` and rewritten on the next `update`.

## Consequences

Team assets live in one private repo, versioned and pinned like the library;
updating a repo is one `update` for all layers. Local edits survive updates.

An override is a fork of one file: it no longer receives upstream fixes, and the
warning only says it changed, not whether the change matters. Overriding a kit
script can break the `justfile` recipes that call it; the installer does not check
kit contracts. Overlay authors must follow the library's layout, since paths are
the merge key.

`git` becomes a hard requirement (it already is in practice: every consumer is a
git repo). CI jobs installing from a private source need a deploy key. Tests stay
offline: fixtures use local bare repositories (`file://`) as sources.

Private content stays out of public repos: only its URL and ref appear in the lock,
and the merged tree is staged in a temporary directory.

## Alternatives considered

- **Private fork of the library**: no code, but every upstream release is a merge,
  and core and team changes are mixed in one history.
- **Claude Code plugin marketplace on a private repo**: syncs skills, agents and
  hooks automatically, but covers Claude only (no Codex `AGENTS.md`, no `.dev/kit`,
  no rules) and replaces "copy, own, pin" with a remote install.
- **Explicit `override: true` per entry**: safer against accidental shadowing, but
  adds ceremony to the common case; the printed list and `baseHash` warning make
  implicit overrides visible instead.
- **Merging file contents (append, patch)**: prose rules have no semantic merge;
  a partial patch fails silently when upstream rewrites the file.
- **A dedicated server**: a git repository already provides storage, versions and
  access control; a service would add hosting for no capability.
- **Gitea API or tarballs instead of `git`**: Gitea's API is close to GitHub's but
  not identical, and needs token handling; `git` works the same on every host.
