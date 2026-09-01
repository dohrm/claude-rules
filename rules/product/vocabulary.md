---
title: "Ubiquitous Language"
---

A project's vocabulary lives in `CONTEXT.md` at the repo root — the project's own
words, the ones code and prose should use verbatim, plus the synonyms to avoid.
A repo with several bounded contexts keeps a root `CONTEXT-MAP.md` pointing at one
`CONTEXT.md` per context instead.

Read it before using project-specific vocabulary, and prefer its terms over any
synonym it flags. It does not exist until the first term is resolved — a missing
file means nobody has needed one yet, not that something is broken.

This is the passive habit; every skill already has it. **Building or sharpening**
the glossary — challenging a term, writing a new entry, recording the ADR a
decision earns — is `domain-modeling`, and is not this rule's job.

`CONTEXT.md` does not follow `product/documents.md`'s unit-plus-index growth
pattern: it grows in place, term by term, never a directory of per-term files
behind a compacted index. One document a reader can hold in their head is the
whole point — a term should never need a second file to be found.
