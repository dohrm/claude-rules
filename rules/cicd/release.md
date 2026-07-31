---
paths:
  - "**/CHANGELOG.md"
  - "**/.github/workflows/release*.yml"
  - "**/.github/workflows/release*.yaml"
  - "**/.gitea/workflows/release*.yml"
  - "**/.gitea/workflows/release*.yaml"
title: "CI/CD — Versioning & Release"
---

A release is a promise to whoever consumes the artifact. Cutting one is the same
kind of act as accepting an ADR (`agent/decisions.md`): an agent prepares it, a
**human decides it**. The signal is the tag — an agent does not push it on its own
authority, and a green pipeline is permission for the code, never for the release.

## The tag is the trigger

- **The version lives in one place** — the manifest (`Cargo.toml`, `package.json`,
  `go.mod` path for v2+). The tag mirrors it; CI verifies they agree and fails
  loudly if they do not. Never two sources of truth for a version number.
- **Tags are immutable.** Never move or re-cut one. A bad release is followed by
  another release, never by a rewritten tag — someone has already fetched it.
- **The release pipeline builds from the tag**, not from a branch, and publishes
  the artifact it just built and tested. Nothing is published from a laptop.

## SemVer, meant literally

`MAJOR.MINOR.PATCH`, applied to the **contract**, not to how much work it took.

- **MAJOR** — an existing consumer breaks: a removed or renamed field, a tightened
  type, a new required input, a changed default, a behavior others relied on.
- **MINOR** — additive and backward compatible.
- **PATCH** — a fix with no contract change.
- `0.x` — MINOR is the breaking slot. Say so in the README rather than pretending
  the guarantee exists.
- Breaking on purpose is fine; breaking **silently** is not. A MAJOR carries a
  migration note: what broke, what to do, and the deprecation window that preceded
  it (see `testing/contract.md`).

## Changelog

- **Written for the consumer**, grouped by what changed for them (Added /
  Changed / Fixed / Removed / Security), newest first, one line each with a link
  to the PR or issue.
- **Generated from conventional commits is fine as a draft, never as the final
  text.** A commit log is a record of work; a changelog is a record of impact.
  Anything a consumer must act on is rewritten by a human in their language.
- An `Unreleased` section accumulates during the cycle so the release itself is a
  rename, not an archaeology session.

## Pre-release checklist (what the agent prepares)

1. Gates green on the release commit (`just check`), Tier 3 included.
2. Version bumped in the single manifest; tag name matches it.
3. `Unreleased` promoted to the new version with a date; entries rewritten for
   consumers; breaking changes and their migration listed first.
4. Contract artifacts regenerated and committed (OpenAPI spec, generated client).
5. The hand-back states: the version, why that increment, what breaks, what a
   consumer must do. Then it **stops** — the human tags.

## Rules

- **No release with a known-failing or skipped gate**, ever. A release that
  bypasses a gate is a bypassed gate shipped to everyone (`agent/autonomy.md`).
- **Sign or checksum published artifacts** and publish the checksums alongside.
- **The published artifact is reproducible from the tag** — same source, same
  toolchain version, same result. Record the toolchain version in the release.
- **Deprecate before removing.** Ship the replacement, mark the old path
  deprecated with the version that removes it, keep it working for at least one
  MINOR, then remove it in a MAJOR.
- **Rolling back is releasing**, not un-releasing: pin consumers to the previous
  version, then fix forward. Never delete the bad artifact from the registry
  (someone has it in a lockfile) — yank/deprecate it instead.

## Checklist

- [ ] Version in exactly one manifest; tag and manifest verified to match in CI
- [ ] Increment follows the contract's actual change, not the effort
- [ ] Changelog written for consumers, breaking changes and migration first
- [ ] Tags immutable; artifacts built and published from the tag by CI only
- [ ] Artifacts checksummed/signed, toolchain version recorded
- [ ] The tag itself is pushed by a human
