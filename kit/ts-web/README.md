# kit/ts-web — the TypeScript web (React) chain

This is a **jalon** derivative of `kit/ts`. Same commands (eslint · tsc ·
vitest), plus `eslint-plugin-react-hooks` and `eslint-plugin-jsx-a11y`,
and a tsconfig that has the DOM lib + `jsx`. The installer copies this
directory to `.dev/kit/ts-web/` and **never merges** the configs.

`claude-rules init` writes `import '.dev/kit/ts-web/ts-web.just'` and
derives `ts_web_dir` from the lock. Pair with profiles `react` and
`portal-flat` + `portal-http`. Never with `ts-tauri` / `tauri`.

## The chain

| Recipe | Tier | When | What it runs |
|---|---|---|---|
| `just ts-web-lint` | 1 | pre-commit | `eslint .` (floor + react-hooks + jsx-a11y) |
| `just ts-web-check` | 2 | pre-push, `just check` | ts-web-lint · `tsc --noEmit` · `vitest run` |
| `just ts-web-mutate` | 3 | coherent block, never a hook | `stryker run --incremental` |

## Configs — copy once, then they are yours

| File | Destination | Read by |
|---|---|---|
| `eslint.react.js` | `<ts_web_dir>/eslint.config.js` | eslint |
| `tsconfig.web.json` | `<ts_web_dir>/tsconfig.json` | tsc |
| `lefthook.snippet.yml` | merge into root `lefthook.yml` | lefthook |

```bash
npm i -D eslint typescript typescript-eslint globals vitest
npm i -D eslint-plugin-react-hooks eslint-plugin-jsx-a11y
npm i react
```

## What this chain cannot see

kebab-case / barrels (`rules/ts/code-style.md`); derive-don't-sync, no
raw `fetch`+`useEffect`, RTL query-by-role (`rules/react/quality-gates.md`);
TanStack Query / OpenAPI layout (`rules/portal-http/`). Do not invent an
eslint pass to "translate" them.
