# kit/ts — the TypeScript language floor

This is a **jalon**: the toolchain already sees lint (`any` / `!`), types
(`tsc --strict`), and tests. The recipes own the commands. The installer
copies this directory to `.dev/kit/ts/` and **never merges** the configs
— you copy them once.

This is the **floor** (a shared package, no React, no Node DOM lib). The
derivatives are their own profiles, each with its own recipe name:

| Profile | Recipe | Overlay |
|---|---|---|
| `ts` | `just ts-check` | this directory |
| `ts-web` | `just ts-web-check` | `kit/ts-web` — react-hooks + jsx-a11y + DOM |
| `ts-node` | `just ts-node-check` | `kit/ts-node` — Node globals, no DOM |
| `ts-tauri` | `just ts-tauri-check` | `kit/ts-tauri` — same React overlay as web; Zustand / invoke stay prose |

`claude-rules init` writes `import '.dev/kit/ts/ts.just'` and derives
`ts_dir` from the lock. Lefthook is a thin trigger: merge
`lefthook.snippet.yml` so pre-commit runs `just ts-lint` and pre-push
runs `just ts-check`.

## The chain

| Recipe | Tier | When | What it runs |
|---|---|---|---|
| `just ts-lint` | 1 | pre-commit | `eslint .` (`recommended` + `no-explicit-any` + `no-non-null-assertion`) |
| `just ts-check` | 2 | pre-push, `just check` | ts-lint · `tsc --noEmit` · `vitest run` |
| `just ts-mutate` | 3 | coherent block, never a hook | `stryker run --incremental` |

Every recipe line is `npm exec --no-install`. The gate is only worth its
exit code if it ran the binaries from the committed lock (`npm ci` on
the runner, then these recipes). Do not wrap them in `npm run lint`.

## Requirements

| Tool | macOS | Linux | Windows |
|---|---|---|---|
| Node.js >= 18 + npm | `brew install node` | your distro's package manager, or [nvm](https://github.com/nvm-sh/nvm) | `winget install OpenJS.NodeJS.LTS` (or `scoop install nodejs`) |

Everything else (`eslint`, `typescript`, `vitest`, `stryker`) is an npm
devDependency — see below, not a separate system install. `ts-web` /
`ts-node` / `ts-tauri` need nothing more than this.

## Configs — copy once, then they are yours

| File | Destination | Read by | Adapt |
|---|---|---|---|
| `eslint.base.js` | `<ts_dir>/eslint.config.js` | eslint (ts-lint) | `globalIgnores` |
| `tsconfig.base.json` | `<ts_dir>/tsconfig.json` | tsc (ts-check) | `include`, path aliases |
| `lefthook.snippet.yml` | merge into root `lefthook.yml` | lefthook | nothing if `just ts-*` exists |
| `mutation-ci.yaml` | `.gitea/workflows/` or `.github/workflows/` | CI, the witness | runner, `working-directory` |

```bash
npm i -D eslint typescript typescript-eslint globals vitest
npm i -D @stryker-mutator/core   # Tier 3 only
```

Commit `package.json` and the lockfile.

## What this chain cannot see

kebab-case filenames, one-barrel-per-folder, no aggregation barrels.
Those stay in `rules/ts/code-style.md`. Do not invent
`eslint-plugin-check-file` to "translate" them.
