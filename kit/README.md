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

## The tiers (same command, three consumers)

| Tier | Where | What | Latency |
|------|-------|------|---------|
| 1 | pre-commit | fmt --check, clippy -D warnings, lint, vet | seconds |
| 2 | pre-push   | test, deny, machete | tens of s |
| 3 | **CI only** | mutation testing (`--in-diff`) — NEVER in the hook | minutes |

Mutation testing re-runs the suite per mutant; putting it in a hook destroys the
fast loop. It is a PR/CI gate, scoped to changed code, ratcheted from a baseline
(a healthy repo often sits ~70%, so it starts non-blocking).

## Consuming in a repo

1. Copy the language folder(s) you need into the repo.
2. **Adapt the marked lines** — workspace paths, the languages present. The
   default Rust fmt gate is the portable `cargo fmt --all --check`. Generated
   code needs exclusion ONLY if your repo has it:
   - Rust with a generated *member* crate (OpenAPI client, etc.): swap the fmt
     command for `rust-fmt.sh` (special case, bash) + add `#![allow(clippy::all)]`
     to the generated crate root (clippy lints path-deps of members; `--exclude`
     does not silence them — the allow does).
   - TS: eslint `globalIgnores([... 'src/api/generated', '**/*.gen.ts'])`.
3. Merge `common/justfile.snippet` into your root justfile (`just check`), then
   `lefthook install`.

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
└── go/                         # COMPLETE
    ├── lefthook.snippet.yml     # Tier 1-2 Go commands (golangci-lint / test -race / govulncheck)
    └── golangci.base.yml        # linter set, mirrors rules/go/quality-gates.md
```

The doctrine (the "why") for each Tier lives in `../rules/rust/quality-gates.md`.

Reference repos: `ctm-k8s-operator` (pure Rust, no generated code → empty
EXCLUDE) and `hwe-platform` (polyglot, generated OpenAPI client → EXCLUDE it).
