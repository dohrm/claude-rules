# kit/rust — the Rust validation chain

This is the **jalon**: a language module whose toolchain already sees
format, lint, types, tests, supply-chain, unused deps, and (opt-in)
mutation. The recipes own the commands. The files below are the configs
those commands read. The installer copies this directory to `.dev/kit/rust/`
and **never merges** the configs into the workspace — you copy them once.

`claude-rules init` writes `import '.dev/kit/rust/rust.just'` and derives
`rust_dir` from the lock. Lefthook is a thin trigger: merge
`lefthook.snippet.yml` so pre-commit runs `just rust-lint` and pre-push
runs `just rust-check`.

## The chain

| Recipe | Tier | When | What it runs |
|---|---|---|---|
| `just rust-lint` | 1 | pre-commit | `cargo fmt --all --check` · `cargo clippy --workspace --all-targets -- -D warnings` · `cargo clippy --workspace --lib --bins -- -D clippy::unwrap_used -D clippy::expect_used` |
| `just rust-check` | 2 | pre-push, `just check` | rust-lint · `cargo test --workspace` · `cargo deny check licenses advisories sources` · `cargo machete --skip-target-dir` |
| `just rust-mutate` | 3 | coherent block, never a hook | `cargo mutants --in-diff` against `{{base}}...HEAD` |

`cargo build` is not a separate line: clippy and `cargo test` already
compile. `unwrap` / `expect` are denied on lib and bins only — tests stay
free. That is why the second clippy pass is `--lib --bins`, not
`--all-targets`.

## Configs — copy once, then they are yours

| File | Destination | Read by | Adapt |
|---|---|---|---|
| `rustfmt.toml` | `<rust_dir>/rustfmt.toml` | `cargo fmt` (rust-lint) | `edition` |
| `deny.toml` | `<rust_dir>/deny.toml` | `cargo deny` (rust-check) | `ignore`, private registry, license allow-list |
| `mutants.toml` | `<rust_dir>/.cargo/mutants.toml` | `cargo mutants` (rust-mutate) | `exclude_re`, `exclude_globs` |
| `lefthook.snippet.yml` | merge into root `lefthook.yml` | lefthook | nothing if `just rust-*` exists |
| `mutation-ci.yaml` | `.gitea/workflows/` or `.github/workflows/` | CI, the witness | runner, `working-directory` |

`rust-fmt.sh` is a **special case**: only when a generated member crate
must be skipped (`cargo fmt --all` would fight the generator). Swap the
fmt line in the root justfile and add `#![allow(clippy::all)]` on that
crate. Most repos never need it.

## What this chain cannot see

Match `/_`, function size, serde, I/O timeouts, thiserror placement,
tracing fields, UTF-8 indexing. Those stay in `rules/rust/` as a mention
for the reviewer. Do not invent a fourth clippy pass to "translate" them.
