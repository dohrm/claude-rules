# ADR reading bench — frozen Quill snapshot

This experiment compares **two reading protocols within the same agent**. It is a reference for future before/after evaluation of architectural exploration and whole-ADR review skills; it does not install either skill. Nothing under this directory is an active rule for Agent Harness. The runner creates a disposable workspace from this directory and never reads the Quill checkout.

[Baseline results from 2026-10-01](./results/2026-10-01/README.md) include 12 real runs and per-run JSON reports.

## Source and fixture

`provenance.json` records the source branch `feat/fiches-personnage`, commit `6ae2994dcf2dc040452e600cebf2d8718859b95b`, path and SHA-256 for every fixture. The 16 numbered ADRs and their index are byte-for-byte copies. The runtime fixture contains three source-line extracts and one exact Cargo manifest. The transport fixture contains a four-line architecture extract. The `.source.md` names deliberately prevent the stale Quill `AGENTS.md`/`CLAUDE.md` from becoming active instructions in the disposable workspace. The line references remain visible. The full source tree is not needed at run time.

The runtime scenario tests the conflict between ADR-0002/0003's Rig choices and ADR-0015's `rust-genai` replacement. Its stale `AGENTS.source.md` extract, newer `CLAUDE.source.md` extract and actual Cargo dependency are all available in both modes. The transport scenario tests ADR-0014's rejection of a shared git remote and ADR-0016's iroh adapter against the stale optional-remote statement in `ARCHITECTURE.md`.

## Design

Each topic has a **current** task (read the decision in force and identify impacts) and an **alternative** task (seriously evaluate a proposed reversal while respecting accepted ADRs). Each task runs in `full` and `index` modes. The question, snapshot and evidence files are identical across the two modes. Only the reading instruction differs:

- `full`: read all 16 ADRs and the index before answering.
- `index`: start at the index and follow relevant ADR links.

This is a within-agent comparison, not a cross-model ranking. Run each pair with the same CLI, model, settings and timeout. Order can affect cache and latency; alternate the order on repeats. No qualitative score is automated.

```bash
node eval/adr-bench/run.mjs --runner codex --case runtime --task current --mode index --setup-only
node eval/adr-bench/run.mjs --runner opencode --bin opencode2 --probe-cli
node eval/adr-bench/run.mjs --runner codex --case runtime --task current --mode full --out /tmp/adr-results
node eval/adr-bench/run.mjs --runner codex --case runtime --task current --mode index --out /tmp/adr-results
# Also: --runner claude|opencode, --bin PATH, --case transport, --task alternative,
#       --model MODEL, --timeout SECONDS (default 180)
```

On this machine, the GPT-configured OpenCode executable is `opencode2` (`opencode v2.0.21`).
Use `--runner opencode --bin opencode2` for its paired runs. `--probe-cli` invokes
only `--version`, with temporary `XDG_DATA_HOME`, so the probe neither loads the
Quill fixtures nor calls a model. It also avoids OpenCode's sandbox error when
its normal data directory is read-only. This probe does not verify a model run.

`--setup-only` prints the workspace path and leaves it for inspection; it spends no model tokens. A real run writes a JSON report, raw JSONL CLI events, and stderr in `--out` (or a new `/tmp` result directory), then removes the disposable fixture. CLI failure returns a nonzero exit. The report records visible tool-read paths and ADR count, elapsed wall time, any CLI token/cost fields, and changed fixture paths. Read-path extraction is **best effort**: a CLI may hide a read, or perform one through a shell command that is hard to classify. Compare this measure alongside the raw event trace, not as an exact filesystem audit. Missing usage/cost fields mean unavailable, not zero. Each run is an independent session.

## Human scoring sheet

Score each response separately before comparing protocols. Mark each criterion `yes / partial / no` and quote the response evidence. Do not use keyword presence alone.

| Criterion | Current-decision task | Alternative task |
|---|---|---|
| Decision in force | Names ADR-0015 + genai or ADR-0014/0016 + packet/iroh accurately | States the same baseline before assessing the proposal |
| Supersession/conflict | Explains 0002/0003 superseded by 0015, or remote line stale against 0014/0016 | Recognizes the same conflict without treating a stale instruction as authority |
| Alternative examined | Identifies rejected/remaining options and why | Gives the alternative its strongest plausible case, specific tradeoffs, and conditions for reconsideration |
| Impacts | Names concrete affected code/docs/boundaries | Names migration, security, testing and documentation implications appropriate to the proposal |
| Evidence discipline | Cites relevant ADRs and fixture paths, distinguishes fact from inference | Same; neither silently changes an accepted ADR nor invents a new decision |

For runtime, look for the surviving in-process agent and thin `ModelBackend`, removal of `RigBackend`/`BackendCapabilities`, `genai::` confined to `crates/agent/src/backend`, custom tool loop, and stale `AGENTS.source.md`. For transport, look for local git history only, typed packets, pre-send GM projection, iroh or offline bundle via the transport port, and the stale optional remote statement. In the alternative task, a good answer should explain *why* one might prefer Rig or remote git, then test that appeal against the documented constraints and identify what would have to change. A refusal without analysis is rigidity; unqualified adoption is also a failure.

Compare paired runs on the above judgments, observed ADR reads, duration and cost when present. Prefer repeated runs before claiming a stable effect. `eval/run.mjs --judge` remains a stub and is unrelated to this scoring sheet.
