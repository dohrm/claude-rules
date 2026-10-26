# Repository audit (maintainer only)

A recurring audit of this repository's skills and rules by several agents, each on a
different model. Never installed: nothing under `maintainer/` is in `registry.json`.
The agent reads [PROCEDURE.md](PROCEDURE.md); this page is for the human.

## Run

One recipe call per agent per round, launched by hand. Each call is headless and
read-only; its stdout lands in `.work/audit-<date>/<agent>-<model>.<mode>.<ext>`.

```bash
just audit-prep                          # run dir, pinned clones, manifest, cost.md, sources.md, issues.md
just audit explore claude opus           # round 1, independent — our defects, one per agent
just audit explore codex <model>
just audit harvest claude opus           # round 1, independent — their ideas, one per agent
just audit harvest codex <model>
just audit synthesize codex <model>      # round 2, one agent
just audit challenge claude opus         # round 2, the other one attacks it
```

`explore` and `harvest` are separate because they compete: hunting our defects yields
`file:line` evidence, borrowing an idea does not, so one prompt doing both drops the
ideas. There is no peer-review round: on the first audit it returned 24 "agree" out
of 24 — the challenge does that job.

Diversity comes from model families, not harnesses: two harnesses on the same model
give the same opinion twice. **Alternate** the synthesizer and the challenger from one
audit to the next — no vote.

`audit-prep` names the run after today; `audit` resumes the latest run, so a run may
span several days. A second audit on one day: `just audit_run=2026-10-21b audit-prep`
(later calls pick it up as the latest).

## Triage (round 3 — yours)

Read the synthesis and the challenge, then append one line per finding to
[ledger.jsonl](ledger.jsonl):

```json
{"id": "...", "status": "accepted", "reason": "...", "audit": "2026-10-21", "ref": "rfc/<slug> | test/<file> | #<ticket> | <commit> | null"}
```

`status`: `accepted` (becomes an RFC, or a test when `mechanizable`) | `rejected` |
`deferred`. A finding a ticket already tracks points at it in `ref`. The next audit will not re-propose a rejected or deferred finding without
new evidence. Implementation goes through `/rfc`, never through the audit.

Commit the run dir and the ledger together: the report is the audit trail.

## Limits

- Only `explore` gets the web, for vendor conventions, because it reads this repository
  alone; `harvest`, `synthesize` and `challenge` read third-party content, directly or
  quoted, and run with the reviewer's deny list. `codex exec --sandbox read-only` has
  no network in any mode.
- Run dirs live in `.work/` like every other work document, so `just code-review`
  skips them: they are reports, not code. The ledger, which binds, lives here.
- An output is never overwritten: move it to `<run>/v<n>/` to re-run a mode. Files in
  a subdirectory are archives and are not read as input.
- No orchestration and no mechanical merge yet: the synthesizer deduplicates. Add them
  once a manual run has calibrated the procedure.
