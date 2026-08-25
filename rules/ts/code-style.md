---
paths:
  - "**/*.ts"
  - "**/*.tsx"
title: "TypeScript Code Style"
---

`any`, `!`, unused names, and `strict` signatures: `just ts-check` (or
the derivative `ts-*-check`).

What they do not decide:

- File and directory names are `kebab-case` (`my-button.tsx`,
  `use-auth.ts`). Identifiers keep standard casing: `PascalCase` types
  and components, `camelCase` functions and hooks — so `use-auth.ts`
  exports `useAuth`.
- A single-file module stays a flat file. Promote to a folder only when
  co-located siblings appear; then one `index.ts` re-exports **that
  module's** public surface. No aggregation barrels.
