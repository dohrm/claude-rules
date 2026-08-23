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
binary — `just`, `lefthook`, `cargo`/`clippy`/`deny`/`machete`, `npm`, `go`, `uv`. A
repo handed to a Windows client runs `just check` unchanged. The **one** exception
is `rust/rust-fmt.sh` (bash), needed ONLY by repos with a generated member crate
— see its header for the portable fallback. (`common/adr-check.mjs`, the hook guards
and the `no-commit-on-trunk` message are Node rather than bash for exactly this
reason; they need Node >= 18 and no dependencies.)

## The tiers (the justfile is the task layer; hooks + `just check` call it)

| Tier | Recipe | Runs on | What | Latency |
|------|--------|---------|------|---------|
| 1 | `just <tech>-lint` | pre-commit | fmt-check, lint `-D warnings` | seconds |
| 2 | `just <tech>-check` | pre-push, `just check` | + tests, deny/machete, build | tens of s |
| 3 | `just mutate-diff` | per coherent block, before the push — and the PR job | mutation on the diff — NEVER a hook | minutes |

`adr-check` sits in Tier 2 but guards a different thing: not whether the code is
correct, but whether a **decision** was taken by a human. A green gate is
permission for code, never for a decision. It also warns (advisory; `--strict` to
enforce) when a record blows the one-screen budget or invents a section — the two
ways a decision log becomes something nobody reads. Doctrine:
`../rules/agent/decisions.md`.

`docs-check` guards the other documents against the same rot. It **fails** when an
index and its units disagree — a link to a unit that does not exist, a unit no index
carries — because those are facts, not judgments; it **warns** on the budgets (index
over a screen, unit over its ceiling, a single-file PRD/PLAN past the split
threshold, a `(continued)` heading). `docs/adr/` is left to `adr-check`. Doctrine:
`../rules/product/documents.md`.

Every budget of both gates is a **default**, overridable per repo in
`.docs-budgets.json` at the root — `{ "prd": { "indexCeiling": 1500 } }`, `null` for
no ceiling, `adr.unitCeiling` for the decision records. Put it there rather than in
the script: the installer never writes that file, so `claude-rules update` cannot
reset it. The gates print the override on every run, so a moved budget stays visible.

The commands **and their paths** live once, in the justfile recipes (via the
`*_dir` variables). lefthook triggers just call `just <tech>-lint`/`-check`
(glob-scoped, layout-agnostic); `just check` runs the full set. One source of
truth — no path duplicated across the kit.

**CI is the third caller of the same recipes**, never a second definition of them:
`cicd/ci.snippet.yaml` runs `just <tech>-check`, so a gate the pipeline enforces is
always one an agent can close its own loop on locally. Doctrine:
`../rules/cicd/pipeline.md`; `/ci-setup` wires it and audits the drift.

Mutation testing re-runs the suite per mutant; putting it in a hook destroys the
fast loop. That makes it a **per-block** gate, not a per-iteration one — and *not*
a CI-only one: `git diff <base>...HEAD` gives the same merge-base set locally that
the PR job computes, so `just mutate-diff` runs it before the push and CI re-runs
it as a witness. It is scoped to changed code and ratcheted from a baseline (a
healthy repo often sits ~70%, so it starts non-blocking). Per language:
`rust/mutation-ci.yaml` (cargo-mutants), `ts/mutation-ci.yaml` (Stryker —
`--incremental` locally, it has no `--since`), `python/mutation-ci.yaml` (mutmut —
path-scoped, so local scopes by path + its cache and CI by the PR's changed files),
and `go/coverage-ci.yaml` — a coverage ratchet, because Go has no production-grade
mutation tool. A survivor has
three possible answers (delete the code / assert it / exclude it), which is why the
doctrine matters more than the tool: `../rules/testing/ratchet.md` (install it with
the `testing` profile).

`dup-check` (jscpd, npx-only) is the other opt-in Tier 2 recipe: copy-paste is the
one AI-slop indicator from `../rules/agent/guardrails.md` a machine can measure.
Baseline it before you enable it — same ratchet as any other metric.

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

The gates are a **just library**, not a template: the repo's root justfile
`import`s them, so `claude-rules update` can still fix a recipe months later.
`common/README.md` is the shipped version of this — including the procedure for
migrating a justfile that predates the library.

Run **`claude-rules init`** to write the justfile + lefthook, or do it by hand:

1. `add` the profiles you need (installs into `.dev/kit/`).
2. Write a root justfile that imports the library — `set allow-duplicate-recipes`
   + `set allow-duplicate-variables` (so this file can override it), one `import`
   line per `.just` under `.dev/kit/`, the `*_dir` variables for your layout, and
   a `check` recipe listing your techs. Never edit a `.just` under `.dev/kit/`:
   override it here instead. Needs just >= 1.27.
3. Merge each `<tech>/lefthook.snippet.yml` (thin triggers) into `lefthook.yml`;
   move the configs into place (deny.toml+rustfmt.toml→`<rust_dir>`, mutants.toml→`.cargo/`,
   golangci.base.yml→`.golangci.yml`, mutation-ci.yaml→`.gitea/workflows/`);
   merge `python/pyproject.snippet.toml` into `<python_dir>/pyproject.toml`;
   adapt eslint `globalIgnores`; then `lefthook install`.
4. **Decision records** (only if the repo keeps ADRs): add `adr-check` to the
   `check` recipe — the script ships with the library and is called from it, so
   there is nothing to move into `scripts/`. The gate makes
   accepting an ADR a human act — it fails when a new ADR is not `Proposed`, or
   when a status line moved without a commit. Doctrine: `../rules/agent/decisions.md`.
   It is a no-op in a repo with no `docs/adr/`.
5. **Code review** (only if an agent CLI is available): set `review_cmd` in your
   justfile to that CLI (override `review_prompt` for a repo-specific prompt) and
   gitignore `.work/`. `just code-review` runs a read-only reviewer once per coherent
   block; `just review-guard` reads the verdict it left behind and blocks a push on a
   `CRITICAL` — merge `common/lefthook.snippet.yml` for that pre-push trigger (it also
   carries the `no-commit-on-trunk` git floor; a solo repo deletes that one command).
   Doctrine: `../rules/agent/autonomy.md`.
6. **Parallel sessions** (only if you run more than one at a time): `just status`.
   The reason it exists is
   the reason it is needed: `.work/` is per-worktree, so `review-guard` answers about
   the tree it runs in — two sessions in one checkout share one verdict. One tree, one
   writer; `just status` is the one command that shows every tree at once (branch,
   dirty, phase worklist, verdict, `## Blocked on the human`). It reports and never
   gates, so it belongs in neither `check` nor a hook.
   Doctrine: `../rules/agent/autonomy.md` ("One tree, one writer").
7. **Harness hooks** (optional, per tool): merge `common/hooks/settings.snippet.json`
   into `.claude/settings.json` — or the cursor snippet beside it.
   This is the **harness layer**, and the split matters: `lefthook` is the git floor (portable,
   every agent), the hooks catch what git never gets to see — the `--no-verify`, the
   `lefthook uninstall`, the `rm` on the review report. Both guards fail open and
   neither makes drift impossible; they make it expensive and loud. Read
   `common/hooks/README.md` for what it does *not* guarantee before relying on it.
8. **Generated code** (only if present): a Rust generated *member* crate — swap
   the fmt command in `rust-check` for `rust-fmt.sh` + add `#![allow(clippy::all)]`
   to that crate (clippy lints path-dep members; `--exclude` won't silence them).
   TS: `globalIgnores([... 'src/api/generated', '**/*.gen.ts'])`.

## Contents

```
kit/
├── common/                     # language-agnostic
│   ├── README.md               # the library/import model + the migration procedure (shipped)
│   ├── gate.just               # the cross-language recipes, imported by the repo's justfile
│   ├── lefthook.snippet.yml    # the git floor: no-commit-on-trunk + review-guard on pre-push
│   ├── adr-check.mjs           # OPT-IN gate: an agent proposes a decision, a human accepts it
│   ├── docs-check.mjs          # OPT-IN gate: PRD/PLAN stay units + a compacted index as they grow
│   ├── review-prompt.md        # the headless reviewer's prompt (`just code-review`, any CLI)
│   ├── review-guard.mjs        # OPT-IN gate: a CRITICAL review blocks the push until a new one clears it
│   ├── worktree-status.mjs     # OPT-IN report, never a gate: every worktree at a glance — `just status`
│   └── hooks/                  # OPT-IN harness layer: what git never gets to see — see its README
│       ├── bash-guard.mjs      #   deny --no-verify/hooksPath/force-push-to-trunk; ask on writes to the gates
│       ├── edit-guard.mjs      #   deny the report + .git/hooks/, ask the rest
│       └── *.snippet.*         #   one wiring snippet per tool: claude · cursor
├── cicd/                       # the pipeline that CALLS the above (Gitea Actions = GitHub Actions)
│   ├── ci.snippet.yaml         # Tier 1-2 gate, one job per tech → `just <tech>-check` + a single required check
│   └── release.snippet.yaml    # tag-driven: tag==manifest, gates, build once, checksum, publish
├── rust/                       # JALON — toolchain owns the chain
│   ├── README.md               # config map: file → destination → recipe
│   ├── rust.just               # rust-lint / rust-check / rust-mutate, imported by the justfile
│   ├── rustfmt.toml            # Tier 1 fmt — copy to <rust_dir>/
│   ├── rust-fmt.sh             # SPECIAL CASE (bash): only if a generated member crate must be skipped
│   ├── lefthook.snippet.yml    # Tier 1-2 Rust commands → merge into root lefthook.yml
│   ├── deny.toml               # Tier 2 supply-chain — copy to <rust_dir>/ (adapt registry / private crates)
│   ├── mutants.toml            # Tier 3 config → copy to <rust_dir>/.cargo/ (adapt exclusions)
│   └── mutation-ci.yaml        # Tier 3 CI job → copy to .gitea/workflows/ (adapt runner)
├── ts/                         # COMPLETE
│   ├── ts.just                 # ts-lint / ts-check / ts-mutate, imported by the justfile
│   ├── lefthook.snippet.yml    # Tier 1-2 TS commands → merge into root lefthook.yml
│   ├── eslint.config.base.js   # base flat config — the reusable part is globalIgnores (generated)
│   └── mutation-ci.yaml        # Tier 3 CI job (Stryker, changed files) → .gitea/ or .github/workflows/
├── go/                         # COMPLETE
│   ├── go.just                  # go-lint / go-check / go-cover, imported by the justfile
│   ├── lefthook.snippet.yml     # Tier 1-2 Go commands (golangci-lint / test -race / govulncheck)
│   ├── golangci.base.yml        # linter set, mirrors rules/go/quality-gates.md
│   └── coverage-ci.yaml         # Tier 3 CI job — a coverage RATCHET, not mutation (header says why)
├── python/                     # COMPLETE
│   ├── python.just              # python-lint / python-check / python-mutate, imported by the justfile
│   ├── lefthook.snippet.yml     # Tier 1-2 Python commands (ruff / mypy --strict / pytest / audit)
│   ├── pyproject.snippet.toml   # ruff+mypy+pytest+deptry+mutmut config → MERGE into pyproject.toml
│   └── mutation-ci.yaml         # Tier 3 CI job (mutmut, changed files — it has no diff mode)
└── portal-http/                # COMPLETE (frontend, pairs with the portal-http profile)
    └── openapi-ts.config.ts     # hey-api codegen config → copy to frontend root, adapt (NOT a gate)
```

The doctrine (the "why") for each Tier lives in `../rules/rust/quality-gates.md`.

Reference repos: `ctm-k8s-operator` (pure Rust, no generated code → empty
EXCLUDE) and `hwe-platform` (polyglot, generated OpenAPI client → EXCLUDE it).
