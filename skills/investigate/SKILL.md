---
name: investigate
description: "Investigate a bug methodically in 4 validated phases: locate/reproduce, 3 ranked root-cause hypotheses, targeted logging, minimal fix. Use on /investigate, or whenever the user describes a symptom (\"it crashes when…\", \"I see X but expect Y\", \"unexpected behavior\", \"why does this crash\", \"investigate this bug\", \"debug this\", \"analyze the bug\"). Never propose an immediate fix — each phase stops and waits for explicit validation before moving on."
---

Before starting, make sure you have two things:
- **The symptom**: what concretely happens (error message, observed behavior, returned value…)
- **The expected behavior**: what should happen instead

If either is missing, ask for it explicitly before going further.

---

Before any fix, run these 4 phases in order. Stop at the end of each one and wait for my validation.

## PHASE 1 — Locate and reproduce
From the symptom, explore the code (use the Explore subagent if needed) to identify the 2–3 zones most likely to host the cause. List them, each with a one-sentence justification. Then describe, in 3 lines, the minimal scenario that reliably replays the bug. If you cannot reproduce it reliably, say so and propose a plan to get there.

## PHASE 2 — 3 ranked root-cause hypotheses
Propose 3 hypotheses about the **root cause** (not the symptom), ranked from most to least likely. For each: the hypothesis in one sentence, then a falsifiable prediction — "if this hypothesis is true, we would observe <precise observation>; if we observe the opposite, we rule it out."

## PHASE 3 — Test hypothesis #1
Add targeted logs to verify hypothesis #1. Prefix every log with the tag `[DEBUG-a4f2]` (4 random characters) so they can be bulk-removed later. Do **not** propose a fix at this phase. Tell me what to observe to confirm or refute it.

**Three-strikes rule:** if all 3 hypotheses are wrong, STOP. This is no longer a code bug, it's an architecture question. Change the angle of attack.

## PHASE 4 — Minimal fix
Once the hypothesis is confirmed, propose the shortest changes that address the root cause. No collateral optimization, no opportunistic refactor. Remove the `[DEBUG-xxxx]` logs, run the project's quality gates, and write the commit message explaining the root cause, not the symptom.
