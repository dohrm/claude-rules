---
name: ci-setup
description: "Bootstrap or audit a repo's CI/CD pipeline from what is actually installed — reads `.claude-rules.lock`, the justfile and the existing workflows, maps the quality-gate tiers to jobs, and writes the workflow files for the repo's forge (Gitea Actions or GitHub Actions). Use on /ci-setup, \"set up CI\", \"add a pipeline\", \"GitHub Actions\", \"Gitea Actions\", \"CI workflow\", \"audit the pipeline\", \"why is CI slow\", \"make CI match the local gates\", \"add a release workflow\", \"branch protection\". It never invents commands: every gate job calls `just`, so the pipeline and the local loop cannot drift. Downstream of the kit — it adapts `kit/cicd/*.snippet.yaml`, it does not design a pipeline from scratch."
---

You wire a pipeline that is a **scheduler and a witness**, never a second
definition of what "correct" means. The commands and the paths live in the
justfile; CI calls them. Doctrine: `cicd/pipeline.md` and `cicd/release.md` — read
them, do not restate them.

Simplicity first: the best pipeline here is a boring one that a developer can
reproduce locally with one command. You are hostile to inline shell in a workflow,
to a job nobody can run on their machine, and to a gate that exists only in CI.

## Process

### 1. Frame — read before asking

- **Forge**: `.gitea/workflows/` or `.github/workflows/` present? Otherwise read
  the remote (`git remote -v`) and ask once. The syntax is the same; the runner
  label is what differs.
- **What is installed**: `.claude-rules.lock` (profiles → technologies), the root
  `justfile` (the recipes and the `*_dir` variables — the ONE source of paths),
  `lefthook.yml` (which tiers already run locally), and the installed kit
  (`.claude/kit/cicd/` — or `.dev/kit/cicd/` for Cursor/Codex/opencode).
- **What exists**: every current workflow file, and whether the repo publishes
  anything (a `bin`/`files` in `package.json`, a `[[bin]]`, a Dockerfile).
- Then ask only what cannot be read: the **runner label**, whether the repo takes
  **fork PRs**, and who may push tags.

If there is no justfile, say so and stop: wire `kit/common/justfile.snippet` first
(`claude-rules init`), because the pipeline you would write otherwise is the drift
this skill exists to prevent.

### 2. Audit — only if a pipeline already exists

Produce a **drift table**, one row per command CI runs:

| CI step | In the justfile? | Verdict |
|---|---|---|

Three verdicts, no fourth: **move it** into a justfile recipe (the default),
**keep it** as a legitimate CI-only exception (Tier 3, publishing, anything needing
a secret — name which), or **delete it** (dead or duplicated). Present the table
and the diagnosis before touching a file.

Also flag: unpinned actions or images, a missing concurrency group, a cached
verdict, a required check that can be skipped, a secret reachable from a fork PR,
and any job with more than a handful of inline shell lines.

### 3. Decide the shape

Propose it in a few lines and get a yes:

- One gate job **per technology** (parallel, and a red job names its toolchain),
  each running `just <tech>-check`.
- Tier 3 as its own job, **non-blocking until ratcheted** (`testing/ratchet.md`).
- One aggregator job (`ci-ok`) as the single required check, so a skipped job
  cannot read as green.
- A release workflow only if the repo publishes something.

### 4. Write

Start from the installed snippets — `kit/cicd/ci.snippet.yaml`,
`kit/cicd/release.snippet.yaml`, and the Tier-3 job from each language kit — and
adapt: delete the jobs for absent technologies, set `runs-on`, pin the toolchain
versions, point the working directories at the justfile's `*_dir` values. Never
copy a command out of the justfile into the workflow.

### 5. Hand off — the human's part

End with the short list only a human can do, each with why:

- the runner label / self-hosted runner,
- the secrets to create (name them; never a value, never in a file),
- the **branch protection**: make `ci-ok` the required check,
- when to flip Tier 3 to blocking (after the baseline is measured),
- who pushes tags — the release trigger is a human act (`cicd/release.md`).

Then stop. You do not push tags, you do not create releases, and you do not enable
branch protection yourself.

## Never

- Add a command to CI that is not runnable locally through the justfile.
- Weaken, skip or `continue-on-error` a gate to make a red pipeline green — that
  is escalation material (`agent/autonomy.md`), not a fix.
- Cache a build result to skip a job. Cache the toolchain; recompute the verdict.
- Write a secret, a token or an internal hostname into a workflow file.
- Leave a required check that can be skipped.
