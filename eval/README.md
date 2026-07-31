# eval — regression harness for the perishable layer (rot detector)

Agents and skills are the **perishable** layer: a new model can silently change how
`code-reviewer` behaves — a review that used to catch a bug starts missing it — or
how `/runbook` writes, or whether `/plan` still splits a document into units. This
harness catches that regression *on a model bump* instead of in the field.

It also catches something a static test cannot: an instruction that is **ambiguous**.
The first run of `postmortem-blameless` failed on a name appearing in the timeline —
the skill said "never name a person as a *cause*", the model complied to the letter,
and the document still travelled with a name in it. The fix was to the skill, not to
the model.

> This is the **token-spending** half of the repo's self-verification. The other
> half — `npm test`, which covers the installer and the asset tree — is
> deterministic, free, and runs on every PR. Only this one is manual.

## How it works

An **agent case** plants a known defect in a fixture and asserts the agent flags it
(or, for a clean fixture, that it does not raise a false alarm). A **skill case**
gives the skill a fixture repo to read and asserts on what it wrote. The runner:

1. makes a throwaway git workspace: the case's `files/` tree committed as the
   baseline, the case's `input.*` on top as the uncommitted working change,
2. installs the target agent or skill + its rules into `.claude/`,
3. invokes it **headlessly** at a chosen `--model` — single-shot, or driven turn by
   turn from the case's scripted `answers`,
4. asserts: regex over what it said, regex over the files it wrote, and the kit's own
   gates run against those files.

**Deterministic first, judge optional.** The model's prose varies; its output *shape*
must not. An optional `--judge` runs a second model call to grade the fuzzy criterion
in `expect.json.judge` when regex cannot express it.

## Running

```bash
node eval/run.mjs                     # all cases, current model
node eval/run.mjs --model <candidate> # re-run against a new model (the point)
node eval/run.mjs runbook-commands    # a single case
node eval/run.mjs --setup-only        # build the workspaces and stop — spends nothing
node eval/run.mjs --keep              # keep the workspaces, print their paths
node eval/run.mjs --timeout 900       # per-case seconds (default 600)
node eval/run.mjs --judge             # also grade fuzzy criteria
```

⚠️ Each case spends real tokens (it calls `claude`). Keep cases **few and
high-value** — this suite tests the perishable layer, so it must not itself
become a maintenance burden. Add a case only when it guards a real behavior.
A skill case runs a whole consultation: budget minutes, not seconds
(`architect-adr-budget` takes 8 turns).

`npm test` validates the cases themselves for free — target exists, requested
rules exist, the gate script exists, and the case asserts *something*. It also runs
the **harness** end to end against a deterministic fake agent
(`test/fixtures/fake-agent.mjs`), which is what keeps `run.mjs` honest without
spending anything — and is the same `--cmd` path any other CLI goes through.

## Running it with another agent

The assets are agent-agnostic, so a regression in them should be observable wherever
they are used. A **runner** is four facts — the command line, the asset layout, the
output format, and what the tool can and cannot do — and they live in one table,
[`runners.mjs`](./runners.mjs).

```bash
node eval/run.mjs --runner opencode                     # a preset
node eval/run.mjs --runner codex --model gpt-5.1        # …with a model
node eval/run.mjs --cmd "agy run {prompt}" --format text --layout agents
node eval/run.mjs --bin ./build/claude                  # the claude preset, another binary
```

| Runner | Layout | Scripted answers | Subagent cases | Status |
|---|---|---|---|---|
| `claude` | `.claude/` | yes — streamed over stdin | yes | **verified** |
| `antigravity` (`agy`) | `.agents/` + `AGENTS.md` | yes — one invocation per turn (`--continue`) | no (agents ship in plugins) | **verified** |
| `opencode` | `.opencode/` + `AGENTS.md` | no | yes | invocation unverified |
| `codex` | `.agents/` + `AGENTS.md` | no | no (no file subagents) | invocation unverified |
| `--cmd …` | `--layout` (default `.claude/`) | no | no | **verified** (fake runner in `test/`) |

An entry marked *unverified* was written from the tool's documented non-interactive
invocation and has never been run here — the harness says so at startup, and a wrong
flag is wrong on exactly one line.

**Confirming one is worth the half hour.** `antigravity` was wrong in three ways at
once, and each failed *silently*: it uses Go-style flags (`--flag value` swallows the
value, so `--dangerously-skip-permissions "…"` made the prompt disappear), `-p` takes
the prompt as its value rather than preceding it, and it **ignores the process cwd** —
it runs from its own install directory, so without `--add-dir` the agent cannot see a
single installed asset and answers confidently from nothing. A `--help` page shows
none of that.

The payoff is the comparison: given the same `/runbook` skill and the same fixture,
Antigravity produced the same section structure and harvested all four real justfile
recipes. That is the question this harness exists to answer — *does the rule survive
the trip to another agent?*

**A local or self-hosted model** is usually not a new runner: Claude Code pointed at
another endpoint is still Claude Code. Export the endpoint and pick the model — the
harness inherits the environment:

```bash
ANTHROPIC_BASE_URL=http://localhost:11434 ANTHROPIC_AUTH_TOKEN=x \
  node eval/run.mjs --model qwen3-coder
```

**Capabilities are enforced, not faked.** A case a runner cannot run is **skipped by
name** (`⊘ SKIP … cannot be driven turn by turn`), never silently downgraded — a
skipped case reads as unverified, which is the truth. `--answers-inline` is the
explicit exception: it folds the scripted answers into the prompt so a single-shot
runner can reach the output, and it prints that the *questioning* is no longer tested.

Comparing runners is the point: the same case, the same assertions, and the gates as
the oracle, tell you whether a rule survives the trip to another agent.

## Case format

```
eval/cases/<name>/
  expect.json     # the target + the assertions
  input.rs        # a single fixture, left UNCOMMITTED — the working change (agent cases)
  files/          # a whole fixture repo, committed as the baseline (skill cases):
                  #   a justfile, docs/, manifests… whatever the skill must read
```

The workspace is a real git repo: a baseline commit, then `input.*` on top as the
change under review. That is what gives the reviewer a diff and `adr-check` a `HEAD`.

`expect.json`:
```json
{
  "agent":              "code-reviewer",       // an agent case (default target)
  "skill":              "runbook",             // …or a skill case: installs skills/<name>
  "rules":              ["common", "agent", "ops"],  // default: common, agent, rust, hexagonal, testing
  "prompt":             "…{file}…",            // default: the per-agent prompt in run.mjs
  "answers":            ["…", "…"],            // a SCRIPTED USER: drives an interactive skill turn by turn
  "gates":              ["adr-check.mjs docs/adr --strict"],  // the kit gate must pass on what was written
  "artifacts": {                               // files the run was supposed to produce
    "docs/runbook/*.md": {                     // the key may end in a glob
      "matches":     ["checkout-killswitch-off"],
      "not_matches": ["(?i)\\bTODO\\b"],
      "max_words":   900
    }
  },
  "stdout_matches":     ["(?i)utf-?8|byte"],   // ALL must appear in the output
  "stdout_not_matches": ["(?i)\\bpanic\\b"],   // NONE may appear
  "file_matches":       ["pub fn resolve_label"],   // on the input.* fixture AFTER the run
  "file_not_matches":   ["\\.clone\\(\\)"],
  "file_changed":       true,                  // the agent must (or must not) have edited it
  "ci_verdict_in":      ["CRITICAL", "WARNINGS"], // the CI_VERDICT line must be one of these
  "judge": "Does the review identify the UTF-8/byte-indexing hazard on &str?"
}
```
Omit any key to skip that check. Everything has a default, so a case is usually
just its fixture + a couple of expectations.

**Assert on the artifact, not the claim.** For a reviewing agent the output *is*
the artifact (`stdout_*`, `ci_verdict_in`). For an editing agent, and for every
skill, the report is only what it *says* it did — the files are the truth
(`file_*`, `artifacts`).

**Let the gates be the oracle.** `gates` runs a `kit/common/*` script against the
workspace and requires exit 0. `/architect` is judged by `adr-check --strict`,
`/plan` and `/prd` by `docs-check --strict` — the same gate the consuming repo
runs. It keeps the assertions deterministic while the prose varies, and it means a
doctrine change lands in one place instead of two.

**The scripted user.** Most skills question you one step at a time, so `answers`
drives the session over `claude --input-format stream-json`: each time a turn
completes, the next answer is sent; when the script runs out, stdin closes and the
session ends. Unused answers are reported (the skill stopped asking early) but do
not fail the case.

Authoring a case costs nothing until you run it: **`--setup-only`** builds every
workspace, prints its tree and the prompt, and stops before spending a token.

## Scope

Each case guards **one claim that would be expensive to lose**.

| Case | Target | The claim |
|---|---|---|
| `reviewer-utf8` | `code-reviewer` | byte-indexing a `&str` is flagged as a UTF-8 hazard |
| `reviewer-unwrap` | `code-reviewer` | `unwrap()` in production code is flagged |
| `reviewer-clean` | `code-reviewer` | clean code returns `CLEAN` — no false alarm |
| `simplifier-nesting` | `code-simplifier` | needless clone, `else`-after-`return` and a nested `if` are flattened, **and** the signature and tests survive |
| `runbook-commands` | `/runbook` | the commands come from the fixture's justfile and manifests, **not** from plausible invention — its central promise |
| `architect-adr-budget` | `/architect` | one decision per ADR, under budget, `Proposed` — judged by `adr-check --strict` |
| `plan-units` | `/plan` | a 9-capability PRD becomes units + a coherent index — judged by `docs-check --strict` |
| `postmortem-blameless` | `/postmortem` | detect/mitigate/resolve separated, no name anywhere, action items owned and dated |

Keep it at that unless a new case guards a behavior a real change depended on. The
skills that are pure dialogue (`/interview`) or whose output is a judgment call
(`/design-system`, `/experience`, `/ui-prompt`) are deliberately not covered: there is
no assertion that would fail for a reason worth acting on.
