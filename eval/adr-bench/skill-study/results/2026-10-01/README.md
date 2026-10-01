# Skill study — frozen Quill ADR corpus (2026-10-01)

This is the first live study of `solution-exploration` and `adr-review` with Claude Code, Codex and OpenCode2. It uses the frozen 16-ADR Quill snapshot in the adjacent bench. The user authorized model transmission of the skill instructions, decision rules and frozen fixtures in the coordinating chat. Each invocation exited successfully, returned a response and left its disposable fixture unchanged. No Quill file or ADR status was modified.

These runs used the [captured skill and rule snapshots](../../provenance.json) and the prompts from that study revision. Some prompts named target discrepancies and suggested a consolidation question. The reports and traces have not been rerun with the current skills, rules, or neutralized prompts; their outcomes do not establish current-version behavior.

## Runs

| CLI | Exploration blind: seconds / observed ADRs | Exploration reconcile: seconds / observed ADRs | ADR review: seconds / observed ADRs |
|---|---:|---:|---:|
| Claude Code | 82.8 / 0 | 95.4 / 10 | 142.3 / 16 |
| Codex | 44.4 / 0 | 99.0 / 10 | 98.5 / 8 |
| OpenCode2 | 70.2 / 0 | 145.9 / 15 | 160.1 / 16 |

Observed ADR counts come from CLI events, not a filesystem audit. Codex's review says it covered all 16 and its answer accounts for all 16, but only eight distinct numbered paths were visible to the read counter. Batching or summary reads may explain the discrepancy; the trace does not prove complete individual reading. Each phase used the CLI's default model; `modelRequested` was unset. The JSON reports preserve the CLI usage fields. Claude Code reported about $0.78 for its two exploration invocations and $0.70 for review. Codex did not report a cost; OpenCode2 reported zero, which does not establish that the model service was free.

## Qualitative assessment

| Check | Claude Code | Codex | OpenCode2 |
|---|---|---|---|
| Blind pass has no ADR available or observed read | Yes | Yes | Yes |
| Blind pass compares credible options and gives the co-GM Git proposal a strong case | Yes | Yes | Yes |
| Provisional recommendation names evidence that could change it | Yes | Yes | Yes |
| Reconciliation identifies ADR-0014/0016 and revises optional remote-Git advice | Yes | Yes | Yes |
| Reconciliation traces privacy, migration, documents and human decisions without editing status | Yes | Yes | Yes |
| Review identifies 0002/0003 → 0015, stale Rig guidance, and Git/iroh drift | Yes | Yes | Yes |
| Review maps all 16 records and rejects a single cross-topic consolidation ADR | Yes in response and trace | Yes in response; eight numbered reads observed | Yes in response and trace |

All three blind passes recommended recipient-scoped portable exchange and treated a shared Git remote as a credible optional channel for trusted co-GMs. After reading the ADRs, all three retained the accepted packet/iroh/bundle direction and said adoption of a remote Git channel would require human arbitration of ADR-0014. They did not invoke Accepted status as the sole reason: they discussed host custody, credentials, projection, merge semantics and the unproven iroh proof of concept. All three noted that iroh connectivity is not evidence of durable delivery when peers never overlap online.

All three reviews correctly counted 14 Accepted and two Superseded ADRs, found the stale Rig agent instruction, the erroneous Git exchange amendment and the optional shared-remote architecture line, and separated documentation repair from architectural decisions. They also detected the later retrieval amendment's disagreement with older evaluation-gated text. OpenCode2 and Claude Code gave the most granular dependency and action maps; Codex grouped related decisions but still covered the known cases. None proposed one ADR to merge unrelated runtime, exchange, retrieval and projection decisions. A separate projection policy remains open.

One notable weakness: Claude Code's final exploration inferred that Markdown/YAML data should merge well with local Git history. The supplied snapshot does not test semantic merges, and local history alone does not deliver changes to an offline remote peer. Claude also identified that delivery gap, so its recommendation should be read with that qualification.

## Relation to the baseline and limits

The earlier [baseline](../../../results/2026-10-01/README.md) already found that all three agents could examine a co-GM Git alternative while respecting the current ADRs. This study therefore demonstrates the intended **two-stage exploration behavior** and broader corpus review on this fixture; it does not establish that the skills improve answer quality over the baseline. The prompts and available context differ, each condition ran once, and CLI defaults/caches may differ. The blind brief itself names candidate architectures, so it isolates ADR document exposure rather than all framing. The second exploration invocation is a fresh conversation given `provisional.md`, not a continuation of hidden model state.

The frozen fixture provides a manifest and selected source extracts, not the full Quill implementation or Git history. Findings about broken links, migration completion, security behavior, Git merges and iroh adoption require verification in the actual project before changing decisions. Reports and raw JSONL traces in this directory support re-scoring.
