---
paths:
  - "**/.github/workflows/*.yml"
  - "**/.github/workflows/*.yaml"
  - "**/.gitea/workflows/*.yml"
  - "**/.gitea/workflows/*.yaml"
title: "CI/CD — Pipeline"
---

The pipeline runs **the same gate the agent runs locally**. It is a scheduler and
a witness, not a second definition of what "correct" means.

## The one rule

**CI calls `just check` (or `just <tech>-check`). It never reimplements the
commands.** The justfile is the single place that knows the paths and the tools —
it composes the gate library (`kit/common/gate.just` and one file per technology);
lefthook triggers call it, `just check` calls it, CI calls it.

A command that exists in CI and not in the justfile is **drift**, and it is
expensive in a specific way: the agent's self-closing loop (`agent/autonomy.md`)
cannot see it. The failure surfaces at PR time instead of in the loop, and the
fix costs a round trip. If a check is worth blocking a merge, it is worth being
runnable locally with one command.

The legitimate exceptions are the things that *cannot* run locally, and they are
fewer than they look: publishing, and anything requiring a secret. That is the
list. **Tier 3 is not on it** — "it needs the PR diff" is not a reason, because
`git diff <base>...HEAD` computes the same merge-base set on a laptop. Mutation
stays out of the *hooks* (minutes per run), not out of the machine: the kit ships
it as `just mutate-diff`, and the PR job re-runs it as a witness.

## Tiers → jobs

| Tier | Where | Blocks |
|------|-------|--------|
| 1 — fmt, lint | pre-commit hook, and inside `just <tech>-check` on PR | yes |
| 2 — tests, deny/vulncheck, build | pre-push hook, and `just check` on PR | yes |
| 3 — mutation / coverage ratchet | `just mutate-diff` before the push, and the PR job — never a hook | not until ratcheted |

One job per technology so they run in parallel and a red one names its own
toolchain. Tier 3 is a separate job (see `kit/rust/mutation-ci.yaml`,
`kit/ts/mutation-ci.yaml`, `kit/go/coverage-ci.yaml`).

## Rules

- **Reproducible locally.** Every failing job must be reproducible by one command
  a developer or agent can run. If reproducing a CI failure requires reading the
  workflow file, the workflow is doing too much.
- **Pin everything.** Actions pinned (tag at minimum, SHA for anything that can
  push or publish), toolchain versions pinned, lockfiles committed, no `:latest`
  image. An unpinned pipeline fails on someone else's release schedule.
- **Fail fast, cancel the stale.** A concurrency group keyed on the ref, with
  cancel-in-progress, so a force-push does not leave three runs racing.
- **Cache the toolchain, never the result.** Caching a build artifact to skip a
  job is how a pipeline starts lying. Cache `~/.cargo`, `node_modules`,
  `GOMODCACHE`; recompute the verdict every run.
- **Least privilege.** Default the job token to read-only and grant write per job.
  Secrets are never available to a fork PR — if a job needs one, it does not run
  on untrusted contributions, and that is stated rather than worked around.
- **No secret in a log.** Never `echo` a secret, never `set -x` around one, never
  pass one on a command line where the process list is visible.
- **Build once, promote the artifact.** The thing tested is the thing deployed —
  never rebuild per environment. Configuration comes from the environment at run
  time (`backend/config.md`), not from a per-environment build.
- **A skipped required check must not read as green.** A conditional job that is
  "required" but skipped is a hole a broken PR walks through. Either the job
  always runs (and short-circuits inside), or it is not a required check.
- **Keep the workflow boring and short.** Long inline shell in a workflow is code
  with no tests, no lint and no local runner — move it into a script the justfile
  calls, and then CI calls the justfile.

## Forge note — Gitea Actions and GitHub Actions

Gitea Actions runs GitHub Actions syntax, and the kit ships one file per gate for
both. The adaptation surface is deliberately tiny:

- `runs-on` — GitHub: `ubuntu-latest`; Gitea: your self-hosted runner's label
  (often `linux`). This is the line you always change.
- Actions come from GitHub on both, but a Gitea instance may proxy or mirror them
  — prefer the widely mirrored `actions/*` and avoid exotic marketplace actions.
- `secrets.GITHUB_TOKEN` exists on both (Gitea injects its own); anything else is
  a repo/org secret you set by hand, and the wiring note must say which.
- Self-hosted runners are **not** ephemeral by default: never assume a clean
  workspace, and never write outside the workspace.

## Checklist

- [ ] Every gate job runs `just …` — no command duplicated from the justfile
- [ ] One job per technology; Tier 3 separate and non-blocking until ratcheted
- [ ] Actions, toolchains and images pinned; lockfiles committed
- [ ] Concurrency group cancels superseded runs
- [ ] Toolchain cached, verdict never cached
- [ ] Token read-only by default; no secret reachable from a fork PR
- [ ] Required checks always run (no skip-as-pass)
- [ ] Artifact built once and promoted, config injected at run time
