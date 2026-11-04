---
paths:
  - "**/*.rs"
title: "Rust Quality Gates"
---

```bash
just rust-check     # rust-lint → tests → deny + machete → rust-audit if Cargo.lock changed
```

`rust-lint` is pre-commit; `rust-check` is pre-push and `just check`. Tier 4 is `just rust-mutate` — never a hook. Wiring: `.dev/kit/rust/README.md`. `rust-check` runs the audit only when `Cargo.lock` changed since its merge base with `base` (or that cannot be known), and prints which: an advisory database moves with the date, not the diff (`rules/cicd/pipeline.md`). `just rust-audit` runs it always.

| Recipe | Command | Config |
|---|---|---|
| `rust-lint` | `cargo fmt --all --check` | `rustfmt.toml` → `<rust_dir>/` |
| `rust-lint` | `cargo clippy --workspace --all-targets -- -D warnings` + `dbg_macro` `todo` `unimplemented` `undocumented_unsafe_blocks` | — |
| `rust-lint` | `cargo clippy --workspace --lib --bins` + `unwrap_used` `expect_used` `panic` `string_slice` | — |
| `rust-check` | `cargo test --workspace` | — |
| `rust-check` | `cargo deny check licenses sources` | `deny.toml` → `<rust_dir>/` |
| `rust-check` | `cargo machete --skip-target-dir` | — |
| `rust-audit` | `cargo deny check advisories` | `deny.toml` |
| `rust-mutate` | `cargo mutants --in-diff` | `mutants.toml` → `<rust_dir>/.cargo/` |

No `#[allow(clippy::…)]` without a reason on the same line. Never loosen the configs or clippy flags to pass.

Sibling rules cover what clippy does not: match/`_`, function size, serde, timeouts, thiserror placement, tracing fields, UTF-8 indexing.
