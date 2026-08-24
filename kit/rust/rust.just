# Rust gates — a just LIBRARY, imported by the repo's root justfile:
#
#     import '.dev/kit/rust/rust.just'
#
# `claude-rules init` writes that line for you, and `claude-rules update` refreshes
# THIS file — so a fix here reaches a repo that installed months ago. Do not edit it:
# override instead. A recipe or variable in the root justfile wins over an imported
# one, which is what the `set allow-duplicate-*` lines at the top of that file buy.
#
# Recipes run with the working directory of the ROOT justfile, never of this file, so
# every path below is repo-relative.

# Where the Rust workspace lives. `init` derives it from the lock's `modules` into the
# root justfile's managed block, which overrides this default.
rust_dir := "."

# Merge-base for Tier 3. kit/common/gate.just defines the same default when `agent
# --level gates` is installed; allow-duplicate-variables on the root justfile
# lets either win. Defined here so `just rust-mutate` parses without common.
base := "origin/main"

# Each line runs in its own shell, so `cd {{dir}} &&` per line (portable: works
# in sh/cmd/pwsh). Split: *-lint is the fast pre-commit tier, *-check the full.
#
# Configs the commands read — copy from this directory, the installer never merges
# them: rustfmt.toml → {{rust_dir}}/, deny.toml → {{rust_dir}}/, mutants.toml →
# {{rust_dir}}/.cargo/. See README.md.
#
# unwrap/expect: a second clippy pass on --lib --bins only. --all-targets would
# deny them in tests; the crate-attribute form in the old rule is no longer needed.
rust-lint:
    cd {{rust_dir}} && cargo fmt --all --check
    cd {{rust_dir}} && cargo clippy --workspace --all-targets -- -D warnings
    cd {{rust_dir}} && cargo clippy --workspace --lib --bins -- -D clippy::unwrap_used -D clippy::expect_used
rust-check: rust-lint
    cd {{rust_dir}} && cargo test --workspace
    cd {{rust_dir}} && cargo deny check licenses advisories sources
    cd {{rust_dir}} && cargo machete --skip-target-dir

# `git diff <base>...HEAD` = changes since the merge-base, i.e. the same set the
# PR job computes. `--relative` inside {{rust_dir}} rewrites the paths so they
# are workspace-relative, which is what cargo-mutants expects when the Rust
# workspace is NOT at the repo root. Needs: cargo install cargo-mutants.
rust-mutate:
    cd {{rust_dir}} && git diff {{base}}...HEAD --relative -- . > pr.diff
    cd {{rust_dir}} && cargo mutants --in-diff pr.diff --no-shuffle
