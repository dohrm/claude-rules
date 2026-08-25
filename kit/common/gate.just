# Cross-language gates — a just LIBRARY, imported by the repo's root justfile:
#
#     import '.dev/kit/common/gate.just'
#
# `claude-rules init` writes that line for you, and `claude-rules update` refreshes
# THIS file — so a fix here reaches a repo that installed months ago. Do not edit it:
# override instead. A recipe or variable in the root justfile wins over an imported
# one, which is what the `set allow-duplicate-*` lines at the top of that file buy.
#
# Recipes run with the working directory of the ROOT justfile, never of this file, so
# every path below is repo-relative.

# The branch a feature is measured against (Tier 3 + code review). Override it from
# the root justfile when the trunk is not origin/main.
base := "origin/main"

# The scripts these recipes call ship WITH this library, so there is nothing to move:
# an update refreshes the gate and its implementation together. Override `review_prompt`
# to point at a repo-specific prompt.
kit           := ".dev/kit/common"
review_prompt := kit / "review-prompt.md"

# ── Code review (Tier 3 — judgment, not correctness) ───────────────────────
# Same cadence as mutate-diff: once per coherent block, BEFORE the push. One
# reviewer, one process, one prompt ({{review_prompt}}) — any agent CLI runs
# it. stdout IS the report, and the recipe parks it in .work/review-report.md, so
# gitignore `.work/`: a report is working memory, never a committed artifact.
#
# Permissions are the point: a reviewer that can edit the code becomes its author,
# and then nobody reviewed it. Getting that right took two corrections, both measured:
#
#   1. `--allowedTools` ADDS to the permission rules the subprocess inherits from
#      .claude/settings.json and settings.local.json — which in a worked-in repo means
#      a hundred-odd allow rules, `chmod`, `curl` and `just:*` among them. It does not
#      replace them. With `--allowedTools 'Read,Glob,Grep'` a reviewer still ran
#      `just --version`. Deny beats allow, so the DENY list is the half that binds.
#   2. `Bash` is not the only door to a shell. Denied it, a reviewer reached for
#      `Monitor` (runs a command, streams its stdout) and said so in its report. Same
#      door in `Workflow`, `Skill`, `CronCreate`, `SendMessage`, `EnterWorktree`.
#
# So review_deny is a DENYLIST OVER AN ENUMERATED SURFACE, not a proof: it is every
# tool the CLI reported having, minus Read/Glob/Grep. A release that adds an executor
# re-opens the door silently — re-enumerate on a CLI bump with:
#   echo 'List every tool available to you, one per line.' | claude -p ...
# The half that does hold is structural: the recipe hands the reviewer the diff and the
# sha, so it needs no shell for the job at all.
review_deny := "Bash,Write,Edit,NotebookEdit,Task,Agent,Artifact,WebFetch,WebSearch,Monitor,Workflow,Skill,ToolSearch,CronCreate,CronDelete,CronList,EnterWorktree,ExitWorktree,LSP,PushNotification,RemoteTrigger,SendMessage,ScheduleWakeup,TaskOutput,TaskStop,ListAgents,ListMcpResourcesTool,ReadMcpResourceTool,WaitForMcpServers,mcp__*"
review_cmd  := "claude -p --disallowedTools '" + review_deny + "' --allowedTools 'Read,Glob,Grep'"
#   cursor:     cursor-agent -p
#
# `{{{{base}}` is how a justfile writes the literal string `{{base}}` (an opening `{{`
# is escaped by doubling it; the closing `}}` needs nothing): sed swaps that placeholder
# and `{{{{sha}}` for this repo's base branch and today's HEAD. The diff follows a plain
# marker rather than a fence, because a fence gets closed early by the first ``` in any
# markdown file's diff.
#
# The prompt goes in on STDIN, never as an argument: `--allowedTools` is variadic, so a
# trailing positional is eaten as more tool rules and the run dies with "Input must be
# provided either through stdin or as a prompt argument" after printing one "Ignoring
# --allowedTools rule" per word of the prompt. A pipe has no argv to mis-parse.
#
# The report is written to `.work/review.tmp` and moved into place, because `>` truncates
# its target BEFORE the CLI runs: a CLI that dies (absent, no key, rate-limited, Ctrl-C)
# left a 0-byte file, review-guard read that as MALFORMED, and since the hook has no
# glob that blocked every push on the machine — with the "no report → passes" escape
# unreachable, because the file existed. Observed in the wild, not theorised.
#
# The temp file is NOT named `review-report.md.part`: that string contains
# `review-report.md`, so bash-guard denied the recipe's own two lines to anyone
# replaying them by hand to debug a review — blocked by the forge-the-report rule while
# doing the opposite of forging.
#
# A dead CLI therefore leaves the PREVIOUS report standing, and that is deliberate: the
# alternative (delete it first) means a rate-limited review CLEARS a CRITICAL, which is
# the hard bypass autonomy.md forbids. The signal that nothing ran is this recipe's
# non-zero exit — read it and hand back "code review not run", never as green. The `mv`
# line stays deny-listed for a hand-typed spelling, on purpose: writing the report by
# hand is a forged verdict, and the recipe is trusted because editing the justfile is
# itself gated.
#
# The guard runs at the end so the verdict comes back as an exit code, not as something
# you have to remember to go and read. Needs a POSIX shell.
code-review:
    mkdir -p .work
    sed -e 's|{{{{base}}|{{base}}|g' -e "s|{{{{sha}}|$(git rev-parse HEAD)|g" {{review_prompt}} > .work/prompt.md
    printf '\n\n=== DIFF UNDER REVIEW ===\n\n' >> .work/prompt.md
    git diff {{base}}...HEAD >> .work/prompt.md
    {{review_cmd}} < .work/prompt.md > .work/review.tmp
    mv .work/review.tmp .work/review-report.md
    node {{kit}}/review-guard.mjs

# The deterministic half of the review — pure Node, no LLM, milliseconds. THAT is
# why it can be a hook (pre-push; never pre-commit, the cadence is per push). It
# reads the two markers at the END of the report (the LAST of each, so a verdict quoted
# mid-report is data): CRITICAL blocks whatever the sha, an absent OR EMPTY report
# passes with a notice (declared, never simulated), a stale CLEAN/WARNINGS passes, a
# malformed one blocks. One test per arm in test/gates.test.mjs; doctrine:
# rules/agent/autonomy.md.
review-guard:
    node {{kit}}/review-guard.mjs

# ── Parallel work (opt-in) ─────────────────────────────────────────────────
# One tree, one writer. `.work/` is per-worktree, so `review-guard` answers about the
# tree it runs in: two sessions in one checkout share one verdict, and A's CLEAN
# authorises B's push (rules/agent/autonomy.md, "One tree, one writer").
# `just status` is the aggregator once you split the work across trees — branch,
# commits ahead of the base branch, dirty count, phase worklist, the verdict it would
# give, and whatever its `## Blocked on the human` section is waiting for. Read-only,
# no LLM, always exit 0: it REPORTS, the gate stays `review-guard` in each tree.
# Rename the recipe if your justfile already has a `status`.
status:
    node {{kit}}/worktree-status.mjs {{base}}

# ── Duplication (opt-in) ───────────────────────────────────────────────────
# Copy-paste is an agent's native failure mode, and it is the one "AI slop
# indicator" from rules/agent/guardrails.md a machine can measure. jscpd is
# npx-only (no install, no server) and language-agnostic. Add `dup-check` to
# `check` once the reported number is at a level you accept — the same
# baseline-then-ratchet sequence as any other metric (rules/testing/ratchet.md).
# Tune --threshold (max % duplication tolerated) and the ignore globs.
dup-check:
    npx --yes jscpd . --min-lines 12 --threshold 3 --reporters consoleFull \
        --ignore "**/node_modules/**,**/target/**,**/dist/**,**/*generated*/**"

# ── Decisions ──────────────────────────────────────────────────────────────
# Opt-in: add `adr-check` to `check` above if the repo keeps ADRs under docs/adr/.
# An agent proposes a decision, a human accepts it — and accepting means committing
# the status line, which is the one signal an agent does not produce on its own.
# Doctrine: rules/agent/decisions.md. Node (>=18) rather than bash, so `just check`
# stays cross-platform; the script is a no-op when there are no ADRs.
adr-check:
    node {{kit}}/adr-check.mjs
    # Size/section budgets are advisory above. Enforce them with:
    #   node {{kit}}/adr-check.mjs docs/adr --strict
    # Move the ceiling for THIS repo in .docs-budgets.json (never in the script — an
    # update overwrites it):  { "adr": { "unitCeiling": 900 } }

# ── Living documents ───────────────────────────────────────────────────────
# Opt-in: add `docs-check` to `check` above if the repo keeps a PRD/PLAN under docs/.
# A document meant to grow is a directory of units plus a compacted index — this fails
# on an index and its units disagreeing (dangling link, unreferenced unit) and warns on
# the budgets. Doctrine: rules/product/documents.md. No-op with no docs/.
# Enforce the budgets too with: node {{kit}}/docs-check.mjs docs --strict
# Budgets are defaults — move them for THIS repo in .docs-budgets.json (never in the
# script, which an update overwrites):  { "prd": { "indexCeiling": 1500 } }
docs-check:
    node {{kit}}/docs-check.mjs

# ── The agent install itself ───────────────────────────────────────────────
# Opt-in: add `rules-check` to `check` above once the install has settled. It audits
# .claude-rules.lock against what is actually on disk and in this repo — an asset the
# lock does not explain, a rule whose globs match no file here, the always-on context
# budget. Offline and deterministic (npx fetches the CLI once, then npm caches it).
# Fails on facts, warns on judgments; `--strict` promotes the warnings.
rules-check:
    npx --yes github:dohrm/claude-rules doctor
