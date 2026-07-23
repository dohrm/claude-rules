---
paths:
  - "**/*.ts"
  - "**/*.tsx"
title: "TypeScript Code Style"
---

## File & Directory Naming

- **File names are `kebab-case`** — `my-button.tsx`, `use-auth.ts`, `billing-list.tsx`.
  Never `PascalCase` or `camelCase` filenames. Applies to every file: components,
  hooks, utils, types. Directories follow the same rule (`main-layout/`, not
  `MainLayout/`).
- **Identifiers keep standard casing**, independent of the kebab file name:
  `PascalCase` for types, interfaces, classes, enums, and React components;
  `camelCase` for functions, variables, and hooks. So `use-auth.ts` exports
  `useAuth`, and `billing-list.tsx` exports `BillingList`.

## Module Layout — Flat by Default, Promote on Growth

- **A single-file module is a flat file** — `my-button.tsx`, not
  `my-button/index.ts` + `my-button/my-button.tsx`. Wrapping one file in a folder
  with a barrel is premature ceremony.
- **Promote to a folder only when the module gains co-located siblings** —
  sub-components, a dedicated hook, styles, tests, stories. Then create
  `my-button/` with an `index.ts` that re-exports **only that module's public
  surface**, so consumers import `from '.../my-button'`, never
  `from '.../my-button/my-button'`.
- **One barrel per module folder, that module only.** Never an aggregation
  `index.ts` that re-exports a whole feature/directory tree — it breaks
  tree-shaking, slows HMR, and invites circular imports.
