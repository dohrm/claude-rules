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

# Merge-base for Tier 4, and the trunk `rust-check` compares Cargo.lock against.
# kit/common/gate.just defines the same default when `agent --level gates` is
# installed; allow-duplicate-variables on the root justfile lets either win. Defined
# here so this file parses without common.
base := "origin/main"

# Each line runs in its own shell, so `cd {{dir}} &&` per line (portable: works
# in sh/cmd/pwsh). Split: *-lint is the fast pre-commit tier, *-check the full.
#
# Configs the commands read — copy from this directory, the installer never merges
# them: rustfmt.toml → {{rust_dir}}/, deny.toml → {{rust_dir}}/, mutants.toml →
# {{rust_dir}}/.cargo/. See README.md.
#
# Clippy's restriction lints, opted in by name — each one is a rule in rules/rust/ a
# machine can check instead of a reviewer. Everywhere: no `dbg!`, no `todo!` /
# `unimplemented!` left behind, every `unsafe` block carries a `// SAFETY:` comment.
# Production code only (a second pass on --lib --bins, since --all-targets would deny
# them in tests): no `unwrap` / `expect` / `panic!`, no `&str` byte slicing
# (utf8-safety.md). A real invariant keeps its `#[allow(clippy::…, reason = "…")]`.
rust-lint:
    cd {{rust_dir}} && cargo fmt --all --check
    cd {{rust_dir}} && cargo clippy --workspace --all-targets -- -D warnings -D clippy::dbg_macro -D clippy::todo -D clippy::unimplemented -D clippy::undocumented_unsafe_blocks
    cd {{rust_dir}} && cargo clippy --workspace --lib --bins -- -D clippy::unwrap_used -D clippy::expect_used -D clippy::panic -D clippy::string_slice
rust-check: rust-lint && (_audit-gate rust_dir "Cargo.lock" rust_audit)
    cd {{rust_dir}} && cargo test --workspace
    cd {{rust_dir}} && cargo deny check licenses sources
    cd {{rust_dir}} && cargo machete --skip-target-dir

# Time-dependent: its verdict moves with the advisory database, not with the diff.
# `licenses` and `sources` stay in rust-check: they are a function of the lock.
# Override `rust_audit`, never the recipe: `rust-check` runs the same command when
# Cargo.lock changed.
rust_audit := "cargo deny check advisories"
rust-audit:
    cd {{rust_dir}} && {{rust_audit}}

# The audit leaves the gate unless the diff touches the lock. An advisory database
# moves on its own schedule, not with the diff: an audit inside `*-check` turns a
# docs-only PR red the day a CVE is published (rules/cicd/pipeline.md). So `*-check`
# runs the audit only when the lock changed since the merge base of `base` and HEAD
# (the working tree and an untracked lock included; a branch merely behind a lock bump
# on `base` changed nothing), or when that cannot be known: `base` empty or
# unresolvable, or no merge base (a shallow clone). Not knowing is not a reason to
# skip. It prints `audit: …` (skipped, changed, unresolvable, empty base, no merge
# base) before running or skipping it.
# `*-audit` runs the tool unconditionally — the scheduled job (kit/cicd) calls it
# daily on the default branch.
# This recipe is identical in go.just, python.just and rust.just; the
# allow-duplicate-recipes header keeps one.
_audit-gate dir lock cmd:
    @if [ -z {{quote(base)}} ]; then \
        echo 'audit: base is empty (in CI: kit/common missing, or ci-base failed to fetch)'; \
    elif ! git rev-parse --verify --quiet {{quote(base)}} >/dev/null 2>&1; then \
        echo {{quote("audit: " + base + " unresolvable")}}; \
    elif ! fork="$(git merge-base {{quote(base)}} HEAD 2>/dev/null)"; then \
        echo {{quote("audit: no merge base with " + base + " (a shallow clone?)")}}; \
    elif git diff --quiet "$fork" -- {{quote(dir / lock)}} \
        && [ -z "$(git ls-files --others --exclude-standard -- {{quote(dir / lock)}})" ]; then \
        echo {{quote("audit: skipped — " + dir / lock + " unchanged against " + base)}}; exit 0; \
    else \
        echo {{quote("audit: " + dir / lock + " changed")}}; \
    fi; \
    cd {{quote(dir)}} && {{cmd}}

# ── Tier 4 economics ───────────────────────────────────────────────────────
# Measured on one real workspace, and the numbers decide which levers are worth
# having: a 32-mutant diff took ~50 minutes, of which **22 were the BASELINE** —
# 972 s of build plus 363 s of test BEFORE the first mutant. cargo-mutants copies
# the tree into a scratch directory and builds it cold, so a warm `target/` in the
# checkout buys nothing. The remaining ~60 s per mutant is an incremental REBUILD,
# not test execution.
#
# Two consequences, both counter-intuitive enough to write down:
#
#   • Mutation in Rust is COMPILE-bound. Shrinking the mutant count (exclusions) or
#     the suite (test selection) helps far less than linking and codegen do. The
#     unit of recompilation is the CRATE — which makes "keep the domain in a small
#     pure crate" a performance rule as well as an architecture one.
#   • A KILLED mutant exits on the first red test; a SURVIVOR pays the whole suite.
#     So the cost spikes exactly when the gate has something to say. Watch that,
#     because a gate that gets slower the more it finds is a gate on its way out
#     (rules/testing/ratchet.md).
#
# `mutate_jobs` matches the `-j 2` mutation-ci.yaml already runs with. Each job gets
# its OWN copy of the build directory, so raising it multiplies DISK, not just CPU:
# a 10 GB target dir at `-j 8` is 80 GB mid-run. Raise it in the root justfile once
# you know what your workspace weighs.
mutate_jobs := "2"

# Everything else is ONE escape hatch rather than five knobs, because every useful
# flag here needs something copied or installed first, and an `update` must never
# change what a repo that installed months ago actually runs. All off by default:
#
#   --profile mutants     needs cargo-profile.snippet.toml merged into Cargo.toml.
#                         `debug = "none"`: debuginfo is expensive to generate and
#                         nobody reads a mutant's.
#   --test-tool=nextest   needs cargo-nextest. Faster startup and per-test timeouts,
#                         so a mutant that hangs dies before `minimum_test_timeout`.
#   --baseline=skip       removes the 1335 s baseline — and is FAIL-OPEN alone: if
#                         the tree is really red, every mutant "fails" and so reads
#                         as killed. Pass it only when something just proved the tree
#                         green in THIS directory (an orchestrator that ran
#                         `just check`, never a human's memory of having run it).
#   --in-place            mutates the real tree instead of copying it, so the warm
#                         target dir applies and the 972 s cold build disappears. An
#                         interrupted run leaves the tree mutated: never in your main
#                         checkout, fine in a dedicated mutation worktree.
#
# It interpolates RAW into the command line, the same convention as `review_exclude`
# in kit/common/gate.just: one flag per word, space-separated, quote anything that
# contains a shell metacharacter yourself.
mutate_args := ""

# `git diff <base>...HEAD` = changes since the merge-base, i.e. the same set the
# PR job computes. `--relative` inside {{rust_dir}} rewrites the paths so they
# are workspace-relative, which is what cargo-mutants expects when the Rust
# workspace is NOT at the repo root. Needs: cargo install cargo-mutants.
#
# `from` is where that range STARTS, and it defaults to the whole branch — the
# behaviour this recipe always had, and the only one available to a repo that
# installed rust without kit/common. Pass it the commit mutation last cleared to
# re-mutate only what is new: `just rust-mutate "$(just mutate-from)"`, which is
# what common/gate.just's `mutate-from` prints. Mutants cost minutes each, so on a
# branch built by successive loops that argument is most of the runtime.
rust-mutate from=base:
    cd {{rust_dir}} && git diff {{from}}...HEAD --relative -- . > pr.diff
    cd {{rust_dir}} && cargo mutants --in-diff pr.diff --no-shuffle -j {{mutate_jobs}} {{mutate_args}}
