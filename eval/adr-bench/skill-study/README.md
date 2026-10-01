# Two-skill study on the frozen Quill ADR bench

This study uses exact copied snapshots of the revised `solution-exploration` and `adr-review` skills from the separate `cde6` worktree. The files were uncommitted there at capture time, so [provenance.json](./provenance.json) records SHA-256 hashes instead of inventing a source commit. The Quill ADR snapshot and fixtures are inherited from the parent bench. The study never reads or edits the Quill checkout at runtime, and it does not modify baseline results.

The captured skill and rule files are retained for the 2026-10-01 live results. Those reports used the captured snapshot and predate the `skillSha256` and rule provenance fields; their provenance is [pinned separately](./provenance.json). New runs use the current skills and decision rules in this repository by default; pass `--revision baseline` to replay the captured versions. New reports record the selected revision plus skill and rule hashes. Two neutral [search cases](./cases/) test a materially changed local proposal and a repeated historically rejected hosted proposal against the same decision history, without altering the Quill snapshot.

## Protocol

`solution-exploration` is a two-invocation test on the transport alternative by default. Pass 1 contains only `problem.md` and the native-layout skill file. There is **no `docs/adr/`, architecture extract, code manifest, or decision rule file** in its workspace. The script saves the first response as `provisional.md`, then reveals all 16 ADRs, index, source extracts, and decision rules for pass 2. Pass 2 is a fresh CLI conversation that reads the saved recommendation before reconciling it with the ADRs. The material separation is stronger than a prompt-only instruction; the new conversation is a limit because it does not preserve hidden model state from pass 1. The problem brief itself is derived from the frozen Quill material and names the candidate architectures, so the test isolates ADR-document exposure, not all possible framing effects.

This harness does not yet test a realistic single invocation with ADR files present from the start. It therefore cannot establish that a model would make its provisional recommendation observable before its first ADR read when both are available. That ordering needs a separate tool-event study; the two-invocation result only establishes behavior under enforced separation.

`adr-review` receives the entire corpus and both discrepancy fixtures at once. Its prompt asks for a status/dependency map, stale guidance, a prioritized action table, and a judgment on whether consolidation clarifies a coherent decision. Neither test authorizes changing ADR statuses or writing to the fixture.

```bash
node eval/adr-bench/skill-study/run.mjs --runner codex --skill solution-exploration --case transport --setup-only
node eval/adr-bench/skill-study/run.mjs --runner codex --skill solution-exploration --case transport --out /tmp/skill-results
node eval/adr-bench/skill-study/run.mjs --runner opencode --bin opencode2 --skill adr-review --out /tmp/skill-results
node eval/adr-bench/skill-study/run.mjs --runner codex --skill solution-exploration --case search-option-a --setup-only
# Also: --case search-option-b
# Also: --runner claude, --case runtime, --revision baseline,
#       --model MODEL, --timeout SECONDS (per invocation; default 240)
```

Each invocation writes a JSON report, raw JSONL events and stderr. Reports retain CLI usage fields, elapsed duration, observed read paths and changed fixture paths. New Claude Code reports also record the model and CLI version from the `init` event when available; `modelRequested` alone is not the model actually used. Read paths are inferred from visible tool events and shell commands; a matching path shows an attempt, not proof that the full file was read. A nonzero exit or fixture edit fails the run. The parent [baseline](../results/2026-10-01/README.md) is a qualitative comparator: prompts and available context necessarily differ, and one run per condition cannot support causal claims about skill quality.

The CLI runs are not hermetic: Claude Code has loaded user settings, plugins and MCP configuration alongside the disposable workspace, as visible in its `init` event. Existing live reports also predate the revised pass-2 prompt that removed the explicit refusal cue. Preserve them as evidence of their own conditions; rerun before making claims about the current prompt or an isolated skill effect.

## Manual scoring

| Skill/stage | Evidence to require |
|---|---|
| Exploration, blind | No numbered ADR read; multiple credible options; strongest case for the contributor's remote proposal; explicit criteria and costs; provisional recommendation with disconfirming evidence. |
| Exploration, reconcile | Cites ADR-0014/0016 and dependencies; says what changed from the provisional view; distinguishes accepted policy from current implementation uncertainty; maps migration, privacy and documentation impacts; does not change accepted statuses. |
| Search option A | After a blind provisional recommendation, finds ADR-0002's `Rejeté` hosted-service proposal and ADR-0001's refused Qdrant-daemon alternative. Compares the exact old proposals with the new app-packaged local index, checks which objections still apply, and identifies missing memory/latency/quality evidence before recommending whether to reopen. |
| Search option B | After the blind pass, recognizes that the hosted proposal repeats ADR-0002's refusal and surfaces the offline and data-egress constraints from the revealed history; checks whether they still govern and what human decision would reopen them. Does not describe it as a materially changed local proposal. |
| ADR review | Evidence of reading all 16; correct 0002/0003 → 0015 succession and 0014/0016 transport relationship; flags stale Rig and remote-git guidance; distinguishes document drift from a new decision; maps status/dependencies and prioritizes actions. |
| Consolidation judgment | A single proposed ADR is acceptable only for one coherent choice; independent client and transport decisions require separate arbitration. Historical ADRs stay intact, and only a human accepts/supersedes them. |

For each item, mark `yes / partial / no` with a response excerpt or cited path. Look for material differences from the baseline in option analysis, dependency tracing and action specificity; avoid judging by length or keywords alone.

In Quill's actual corpus, `0010-rejected-technical-scope.md` is **Accepted** despite its title. It records rejected technical options; it is not an ADR with `Rejected` status. The synthetic history exercises that separate status case explicitly with `Statut : Rejeté`.
