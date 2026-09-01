# kit/ts-tauri — the TypeScript Tauri (React webview) chain

This is a **jalon** derivative of `kit/ts`. Same commands and the same
React overlay as `ts-web` (hooks + jsx-a11y + DOM). The recipe name is
what differs: a desktop app's `check` says `ts-tauri-check`, not
`ts-web-check`. The installer copies this directory to
`.dev/kit/ts-tauri/` and **never merges** the configs.

`claude-rules init` writes `import '.dev/kit/ts-tauri/ts-tauri.just'`
and derives `ts_tauri_dir` from the lock. Pair with `react` +
`portal-flat` + `tauri` + `rust`. Never with `portal-http` / `ts-web`.

The Rust host is `just rust-check`. This recipe does not run
`cargo tauri build`.

## The chain

| Recipe | Tier | When | What it runs |
|---|---|---|---|
| `just ts-tauri-lint` | 1 | pre-commit | `eslint .` (floor + react-hooks + jsx-a11y) |
| `just ts-tauri-check` | 2 | pre-push, `just check` | ts-tauri-lint · `tsc --noEmit` · `vitest run` |
| `just ts-tauri-mutate` | 3 | coherent block, never a hook | `stryker run --incremental` |

## Requirements

Same as `kit/ts` (Node.js >= 18 + npm) — see its Requirements section. The
Rust host's requirements are `kit/rust/README.md`'s.

## Configs — copy once, then they are yours

| File | Destination | Read by |
|---|---|---|
| `eslint.react.js` | `<ts_tauri_dir>/eslint.config.js` | eslint |
| `tsconfig.webview.json` | `<ts_tauri_dir>/tsconfig.json` | tsc |
| `lefthook.snippet.yml` | merge into root `lefthook.yml` | lefthook |

## What this chain cannot see

`invoke` / `listen` wrappers, Zustand stores under
`features/{domain}/api/`, the ban on TanStack Query
(`rules/tauri/app.md`). The Rust host (`just rust-check`). Do not
invent an eslint pass to "translate" them.
