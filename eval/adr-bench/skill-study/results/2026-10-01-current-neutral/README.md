# Current ADR skills: independent review and neutral-prompt checks

The user requested a second opinion from Claude Code on the ADR skills and their isolated bench. Three read-only review passes were performed while narrow defects were corrected. The first review found that the rejection fixture and prompts disclosed target conclusions, the French `Rejeté` status was missing, and `architect` and the shared rule conflicted with the blind first pass. The second review verified those corrections and found residual fixture ambiguity, stale copied rules and incomplete provenance. A final focused audit confirmed those fixes but found one remaining cue in the pass-2 prompt (`past refusals if relevant`); that cue was removed before the final two-case run below. The review also identified user-level Claude configuration as a limit on isolation. The reviews did not edit files.

## Final neutral-prompt runs

All five reports use the current skills and current decision rules. The `adr-review` report was captured before the final pass-2 prompt edit, which did not affect its neutral review prompt or skill and rule hashes. Reports include skill and rule hashes, observed model and Claude Code version when available. All invocations exited 0, returned a response and changed no fixture files.

| Case | Blind pass: seconds / observed numbered ADRs | Reconcile or review: seconds / observed numbered ADRs | Observed behavior |
|---|---:|---:|---|
| In-process semantic search (A) | 66.9 / 0 | 61.5 / 2 | Distinguishes the in-process option from the rejected hosted service and the daemon alternative refused inside an Accepted ADR. Retains memory measurement and a human Proposed ADR before adoption. |
| Hosted vector search (B) | 75.7 / 0 | 58.4 / 2 | Identifies the proposal as the same one in the Rejected ADR. Names offline search and no campaign-text egress as reasons still in force, and says a human would need to change those constraints to reopen it. |
| Corpus-wide ADR review | — | 160.2 / 16 | With a prompt that names no expected conflicts, finds the Rig → genai succession, stale Rig instructions, Git remote drift, and retrieval-gate disagreement; proposes a separate consolidation only for the coherent dense-retrieval choice. |

In B, the blind pass already preferred local search for practical reasons, but left hosted search as a candidate pending policy. The ADR pass changed its status from a candidate to a previously refused choice with recorded constraints. These results support recognition and use of rejection history on these fixtures; they do not show that the skill caused a change of preferred architecture. No ADR status was changed.

## Limits

- One run per case, with Claude Code only. Codex and OpenCode2 have not run the revised rejection cases.
- The harness physically withholds ADRs during pass 1 and starts a fresh conversation for pass 2, carrying the provisional answer in `provisional.md`. It does not test whether a model independently avoids reading ADRs early when all files are present in one session.
- The model used user-level Claude configuration, plugins and MCP setup. The reports record the observed model and CLI version, but the environment was not hermetic.
- Read counts infer paths from visible tool events. They do not prove complete reading, and command or search patterns can be missed.
- The earlier [baseline](../../../results/2026-10-01/README.md) and [first skill study](../2026-10-01/README.md) used different prompts, revisions and context. They are useful reference points, not a causal comparison.
