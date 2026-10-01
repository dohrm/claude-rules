# ADR-0001: Local lexical search for the first release

**Statut :** Accepté

## Context

The first release searches about 5,000 markdown notes on laptops with a 1.5 GB search-memory budget. The product must work offline. No evaluation yet shows that semantic retrieval materially improves campaign tasks.

## Decision

Use a local lexical index for the first release. Revisit search quality when real synonym and recall failures can be measured.

## Consequences

The index is small and works without a service, but semantic matches may be missed.

## Alternatives considered

- A dedicated Qdrant daemon was refused for this release: operating another process and its estimated 2 GB resident memory exceeded the laptop budget.
