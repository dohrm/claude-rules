# Baseline run — 2026-10-01

Frozen Quill source: `feat/fiches-personnage` at `6ae2994dcf2dc040452e600cebf2d8718859b95b`. All 12 final runs exited 0, produced a response, and left the disposable fixture unchanged. The Quill checkout was read-only and remained clean. Individual JSON reports in this directory contain the questions, responses, observed read paths, duration, usage fields and model identification. Raw CLI event streams were retained only in `/tmp/adr-bench-live-2026-10-01` on the run host.

The selected two pairs per CLI were `runtime/current` (quality of reading the decision in force) and `transport/alternative` (willingness to examine a proposed remote git path). The other two case/task combinations remain available but were not run. Each pair used the same CLI default model and fixture for both modes; only the reading instruction differed. Every pair ran **index first, then full**, so order/cache effects are possible.

| CLI and model | Task | Index: ADRs / seconds | Full: ADRs / seconds | CLI cost |
|---|---|---:|---:|---|
| Claude Code · `claude-opus-5-5` | Rig/genai current | 6 / 49.9 | 16 / 64.2 | $0.290 / $0.477 |
| Claude Code · `claude-opus-5-5` | Remote git alternative | 3 / 72.9 | 16 / 77.6 | $0.301 / $0.470 |
| Codex · `gpt-6-sol` | Rig/genai current | 5 / 48.2 | 16 / 64.6 | unavailable |
| Codex · `gpt-6-sol` | Remote git alternative | 5 / 147.7 | 16 / 84.8 | unavailable |
| OpenCode `opencode2` · `openai/gpt-6.1-sol` | Rig/genai current | 5 / 66.9 | 16 / 89.6 | CLI reports 0 / 0 |
| OpenCode `opencode2` · `openai/gpt-6.1-sol` | Remote git alternative | 5 / 85.3 | 16 / 88.6 | CLI reports 0 / 0 |

Read counts are **observations from tool events**, including numbered ADR globs passed to `cat`; they are not an exact filesystem audit. The OpenCode model identifier was checked in its local session record, Claude's in message events, and Codex's in its local default configuration. Token/usage data are preserved in each JSON report, but their accounting and cache fields differ across CLIs. OpenCode's reported zero cost does not establish that the external model service was free.

## Manual review against the scoring sheet

For `runtime/current`, all three agents in both modes identified ADR-0015 as the decision in force, treated ADR-0002 and ADR-0003 as superseded, preserved the in-process agent and thin `ModelBackend` seam, confined `genai::` to `crates/agent/src/backend/`, and recognized `AGENTS.source.md` as stale. They named code, test and documentation impacts. The fixture contains no agent implementation source, so none could verify migration completion.

For `transport/alternative`, all three agents in both modes gave a substantive case for a **co-GM-only** git remote: trusted full replicas, mature git history/merge tooling and asynchronous hosting. They also addressed the explicit ADR-0014 rejection, the iroh decision in ADR-0016, player spoiler risk, remote custody/credentials, projection, and the need for a new or revised ADR before adoption. This is evidence of examining the alternative in these six runs, not a general rigidity score. They identified the stale optional-remote line in the architecture extract. Several also flagged ADR-0001's amendment banner as inconsistent with ADR-0014; that issue is present in the frozen snapshot and was not changed in Quill.

Index reading used fewer observed ADRs in every pair. It was faster in five of six pairs; Codex's transport index run took 147.7 seconds versus 84.8 seconds for full reading. Claude's index runs had lower CLI-reported cost in both pairs. These are **single runs** with differing cache and CLI conditions, so they show feasibility and possible savings, not a stable causal effect. A repeated, order-balanced run would be needed to estimate that effect.

## Verification and limits

The first Codex full runtime attempt hit the 180-second limit while reading ADRs; a repeat with a 300-second limit completed in 64.6 seconds and is the reported result. Initial smoke runs also exposed temporary-workspace and CLI flag issues, which were corrected before the final 12 runs. The deterministic ADR bench and eval harness tests pass (12/12). The earlier full `npm test` run had 332 passes, 7 skips and 2 Python gate failures caused by newly reported `urllib3 2.7.0` vulnerabilities, outside this bench.

No qualitative judge model was used. `eval/run.mjs --judge` remains a stub; the assessment above is a human reading of the response texts using the bench's scoring sheet. No status of an accepted ADR was changed, and the proposed future skills were not created.
