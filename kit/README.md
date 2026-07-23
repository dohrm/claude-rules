# kit — executable quality gates (copy + wire; unlike rules, not auto-loaded)

Rules (`../rules/`) are prose the agent *reads* → they **auto-load** from
`.claude/rules/` (nothing to wire). The **kit** is different: it is config the
*tools execute* (lefthook, rustfmt, deny, mutants, CI). A `lefthook.yml` must
physically sit at the repo root and be wired into the toolchain, so the kit is
consumed by **copy + one-time wiring**, not auto-load.

The doctrine (why these gates, the tiers) lives in `../rules/*/quality-gates.md`.
This directory is its executable counterpart — reference implementations you
copy and adapt.

**Cross-platform (Windows/mac/linux):** every default command is a cross-platform
binary — `just`, `lefthook`, `cargo`/`clippy`/`deny`/`machete`, `npm`, `go`. A
repo handed to a Windows client runs `just check` unchanged. The **one** exception
is `rust/rust-fmt.sh` (bash), needed ONLY by repos with a generated member crate
— see its header for the portable fallback.

## The tiers (the justfile is the task layer; hooks + `just check` call it)

| Tier | Recipe | Runs on | What | Latency |
|------|--------|---------|------|---------|
| 1 | `just <tech>-lint` | pre-commit | fmt-check, lint `-D warnings` | seconds |
| 2 | `just <tech>-check` | pre-push, `just check` | + tests, deny/machete, build | tens of s |
| 3 | *(CI only)* | PR | mutation testing (`--in-diff`) — NEVER a hook | minutes |

The commands **and their paths** live once, in the justfile recipes (via the
`*_dir` variables). lefthook triggers just call `just <tech>-lint`/`-check`
(glob-scoped, layout-agnostic); `just check` runs the full set. One source of
truth — no path duplicated across the kit.

Mutation testing re-runs the suite per mutant; putting it in a hook destroys the
fast loop. It is a PR/CI gate, scoped to changed code, ratcheted from a baseline
(a healthy repo often sits ~70%, so it starts non-blocking).

## Layout convention (recommended)

For a polyglot repo, the cleanest structure is **one workspace per technology at
a predictable top-level directory** — e.g. a Rust workspace under `api/`, the
frontend under `apps/web/`, the Go module under `workflows/orchestration/`.
Predictable roots make the per-tech gate paths obvious and keep each toolchain
self-contained. The gate commands then live in ONE place — the repo's `justfile`
(`just rust-check`, `just ts-check`, …) — and both `just check` and the git
hooks call them, so no path is hardcoded in the shared kit. A single-language
repo just keeps its workspace at the root.

## Consuming in a repo

Run **`claude-rules init`** to assemble the justfile + lefthook from the
installed snippets, or do it by hand:

1. `add` the profiles you need (installs into `.claude/`).
2. Merge `common/justfile.snippet` into your root justfile and **set the `*_dir`
   variables** to your layout — the ONE place paths live. Enable your techs in
   the `check` recipe.
3. Merge each `<tech>/lefthook.snippet.yml` (thin triggers) into `lefthook.yml`;
   move the configs into place (deny.toml→`<rust_dir>`, mutants.toml→`.cargo/`,
   golangci.base.yml→`.golangci.yml`, mutation-ci.yaml→`.gitea/workflows/`);
   adapt eslint `globalIgnores`; then `lefthook install`.
4. **Generated code** (only if present): a Rust generated *member* crate — swap
   the fmt command in `rust-check` for `rust-fmt.sh` + add `#![allow(clippy::all)]`
   to that crate (clippy lints path-dep members; `--exclude` won't silence them).
   TS: `globalIgnores([... 'src/api/generated', '**/*.gen.ts'])`.

## Contents

```
kit/
├── common/                     # language-agnostic
│   └── justfile.snippet        # `just check` — the one command an agent runs to self-verify
├── rust/                       # COMPLETE
│   ├── rust-fmt.sh             # SPECIAL CASE (bash): only if a generated member crate must be skipped
│   ├── lefthook.snippet.yml    # Tier 1-2 Rust commands → merge into root lefthook.yml
│   ├── deny.toml               # Tier 2 supply-chain (adapt registry / private crates)
│   ├── mutants.toml            # Tier 3 config → copy to <workspace>/.cargo/ (adapt exclusions)
│   └── mutation-ci.yaml        # Tier 3 CI job → copy to .gitea/workflows/ (adapt runner)
├── ts/                         # COMPLETE
│   ├── lefthook.snippet.yml    # Tier 1-2 TS commands → merge into root lefthook.yml
│   └── eslint.config.base.js   # base flat config — the reusable part is globalIgnores (generated)
├── go/                         # COMPLETE
│   ├── lefthook.snippet.yml     # Tier 1-2 Go commands (golangci-lint / test -race / govulncheck)
│   └── golangci.base.yml        # linter set, mirrors rules/go/quality-gates.md
└── portal-flat/                # COMPLETE (frontend, pairs with the portal-flat profile)
    └── openapi-ts.config.ts     # hey-api codegen config → copy to frontend root, adapt (NOT a gate)
```

The doctrine (the "why") for each Tier lives in `../rules/rust/quality-gates.md`.

Reference repos: `ctm-k8s-operator` (pure Rust, no generated code → empty
EXCLUDE) and `hwe-platform` (polyglot, generated OpenAPI client → EXCLUDE it).
