---
paths:
  - "**/*.ts"
  - "**/*.tsx"
title: "TypeScript Quality Gates"
---

```bash
just ts-check          # language floor: eslint → tsc --noEmit → vitest
just ts-web-check      # React portal (HTTP)
just ts-node-check     # Fastify service
just ts-tauri-check    # React webview (Tauri)
```

Pick the recipe that matches the runtime. `ts-lint` / `ts-*-lint` is
pre-commit; `*-check` is pre-push and `just check`. Tier 3 is `*-mutate`
(Stryker) — never a hook. Wiring: `.dev/kit/ts/README.md` (and the
matching derivative README).

| Recipe | Command | Config |
|---|---|---|
| `ts-lint` | `eslint .` | `eslint.config.js` ← `eslint.base.js` (`no-explicit-any`, `no-non-null-assertion`) |
| `ts-check` | `tsc --noEmit` | `tsconfig.json` ← `tsconfig.base.json` (`strict`) |
| `ts-check` | `vitest run` | — |
| `ts-mutate` | `stryker run --incremental` | `stryker.config.json` |

Derivatives add an overlay, not a second language: `ts-web` / `ts-tauri`
ship react-hooks + jsx-a11y + DOM; `ts-node` ships Node globals and no
DOM. Every recipe line is `npm exec --no-install`.

No `@ts-ignore` / `@ts-expect-error` / `eslint-disable` without a reason
on the same line. Never loosen the configs to pass.

Generated code (`src/api/generated`, `**/*.gen.ts`) is in
`globalIgnores` — regenerate, do not patch.

What eslint / tsc do not decide: kebab-case filenames, one barrel per
folder (`rules/ts/code-style.md`); Fastify schemas (`rules/api/node.md`);
Zustand / invoke (`rules/tauri/app.md`).
