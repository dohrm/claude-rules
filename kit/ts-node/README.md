# kit/ts-node — the TypeScript Node chain

This is a **jalon** derivative of `kit/ts`. Same commands (eslint · tsc ·
vitest), with Node globals and a tsconfig that has **no DOM lib**. The
installer copies this directory to `.dev/kit/ts-node/` and **never
merges** the configs.

`claude-rules init` writes `import '.dev/kit/ts-node/ts-node.just'` and
derives `ts_node_dir` from the lock. Pair with profiles `api` +
`backend` (Fastify). Not a frontend.

## The chain

| Recipe | Tier | When | What it runs |
|---|---|---|---|
| `just ts-node-lint` | 1 | pre-commit | `eslint .` (floor + `globals.node`) |
| `just ts-node-check` | 2 | pre-push, `just check` | ts-node-lint · `tsc --noEmit` · `vitest run` |
| `just ts-node-mutate` | 3 | coherent block, never a hook | `stryker run --incremental` |

## Requirements

Same as `kit/ts` (Node.js >= 18 + npm) — see its Requirements section.

## Configs — copy once, then they are yours

| File | Destination | Read by |
|---|---|---|
| `eslint.node.js` | `<ts_node_dir>/eslint.config.js` | eslint |
| `tsconfig.node.json` | `<ts_node_dir>/tsconfig.json` | tsc |
| `lefthook.snippet.yml` | merge into root `lefthook.yml` | lefthook |

```bash
npm i -D eslint typescript typescript-eslint globals vitest @types/node
```

## What this chain cannot see

A Fastify route without a `schema`, OpenAPI emission, thin handlers,
problem+json shape (`rules/api/node.md`, `rules/backend/`). Do not
invent an eslint pass to "translate" them.
