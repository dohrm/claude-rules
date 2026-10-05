# ADR-0005: Reserve project ADRs for cross-feature arbitrations; give every other decision a home

- **Status**: Accepted
- **Date**: 2026-10-05

## Context

A survey of four consuming repositories counted 119 ADRs, about 6,000 lines. Only 39% are
project architecture. 28% are feature-local details (a field format, one webhook
rule), 29% are enterprise policy or stack conventions repeated across repos, and 4%
are product rules. The assets drive this: the "we will outside Decision" test forces
splits, ADRs end with lock clauses ("do not … without a new ADR") so each later
change needs a new record, each rule deviation gets its own ADR, `/observability`
mandates one ADR per SLO target, and a fixed template costs ~47 lines regardless of
stakes. One capability alone produced 7 ADRs. Status drift in two repos shows
that the acceptance load has outgrown the human.

## Decision

We will keep a project ADR only for an arbitration that is hard to reverse, constrains
more than one feature, and refused real alternatives at a real cost. The rest goes to:

- **Enterprise policy** (security, secrets, identity, data protection, observability,
  deployment): a shared decision repository, outside projects, that every project
  of the same organization follows.
- **Stack conventions**: claude-rules profiles and kit.
- **Feature-local choices**: the feature's work document (ADR-0006) and its PR.
- **Product and design rules**: PRD, `DESIGN.md`, `EXPERIENCE.md`, domain documents.

Also:

- A rule deviation is an in-place exception with its reason. A recurring one changes
  the shared rule.
- An ADR never carries lock clauses.
- The "we will outside Decision" test is dropped; one arbitration per record stays.
- `/architect` and `/observability` stop mandating ADRs per decision or per SLO target.

## Consequences

The reason for a local choice survives only in the PR once the work document is
deleted. The shared repository needs its own owner and acceptance flow, and how
projects consume it is undecided. Agents make more unasked local choices. Existing
corpora stay valid until migrated with `/adr-review`, one pilot repository first.

> **Amendment 2026-10-05** — consumption decided: a project declares its shared
> decision repository in `docs/ARCHITECTURE.md`, asked for at `/architect` and
> `/onboard`. Skills read it read-only and, on an organization-wide finding, prepare
> a PR there and ask before opening it (`agent/decisions.md` § Shared decisions).

## Alternatives considered

- Keep the corpus, read through the index: cuts reading cost (≈ -37% in the bench), not acceptance load or cascades.
- Tighten the threshold wording only: added on 2026-09-14, outweighed by the mechanisms above.
- Keep enterprise policy in each project: the survey found the same policies rewritten repo by repo.
- Enterprise policy as claude-rules rules: language-agnostic policy is not a coding convention, and this library is public.
