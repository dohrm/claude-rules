---
name: runbook
description: "Write the operational runbook for one alert or failure mode, using the repo's real commands: symptom, impact, the first move that restores service before anyone understands why, ordered checks with what a good and a bad answer look like, escalation, and what NOT to do. Produces `docs/runbook/<slug>.md`, one screen, rehearsable. Use on /runbook, \"write a runbook\", \"operational documentation\", \"what do we do when X breaks\", \"on-call procedure\", \"this alert has no runbook\", \"how do we roll back\", \"incident procedure\". Required by `ops/slo.md` — an alert with no runbook is not shippable — and called by /observability when it builds the alert table."
---

You write for a responder who was asleep four minutes ago, not for a reader who wants
to understand the system. **Restoring service comes before understanding it**
(`ops/delivery.md`): the first move is the one that stops the bleeding, and diagnosis
comes after. Every step is a command they can paste. A step that says *"check the
logs"* is not a step.

Output: `docs/runbook/<slug>.md` — one runbook per **failure mode**, one screen. Its
index is the alert table in `docs/OBSERVABILITY.md`; if there is none, keep
`docs/runbook/README.md` as the table (`product/documents.md`).

## Process

### 1. Frame — one failure mode, and the real commands

- **Which failure mode?** One runbook per thing that fails, not per service. If the
  answer is "when the service is down", that is three runbooks (dependency down, bad
  deploy, resource exhaustion) — say so and pick one.
- Read `docs/OBSERVABILITY.md` for the alert that points here, and `ops/slo.md`'s
  severity meaning: a page implies a user-visible symptom and an action available now.
- **Harvest the real commands from the repo** — the `justfile` recipes AND the files it
  `import`s (a root justfile usually holds only the composition; the commands live in
  `.dev/kit/*/*.just`, so `just --summary` lists the names and the library holds the
  bodies), the deploy
  manifests (actual namespace, deployment and container names), the CLI, the migration
  tool, the flag mechanism. A runbook full of plausible-looking commands is worse than
  no runbook: it costs the responder the time to discover each one is wrong.
- Ask only what the repo cannot answer: **who is on call**, what access they have, and
  whether a kill switch or a flag already exists for this path.

### 2. Find the first move

The mitigation that restores service **without a diagnosis**. In order of preference:
flip the flag / kill switch, roll back the release, promote the previous artifact,
scale, drain the bad instance. If none of those exist for this failure mode, that is
the finding — say it out loud, because it is a gap in the system, not in the document.

### 3. Order the checks by likelihood × cheapness

Each check is: the command, then **what a good answer looks like and what a bad one
means**. A check whose result changes nothing the responder does is deleted. Stop the
list where the responder should escalate instead of continuing.

### 4. Escalation and the forbidden moves

- **Escalate to whom, after how long, with what in hand** — the correlation id, the
  timeline so far, what was already tried.
- **What NOT to do**, explicitly: the destructive temptations for this failure mode
  (deleting the queue, truncating the table, forcing the migration, restarting
  everything at once, editing production by hand). Name them, because under pressure
  they look like progress.

### 5. Write it, then rehearse it

Write the file using `<runbook-template>`. Then **walk it through with the user, step
by step, on the current system**. A runbook nobody has executed is a hypothesis — the
same rule as an untested rollback path. Record the rehearsal date; if it cannot be
rehearsed now, mark it `Unrehearsed` and say so in the hand-back.

End with what only a human can do: grant the access the runbook needs, create the
missing kill switch, and link it from the alert.

<runbook-template>
# Runbook — <failure mode>

- **Alert**: <name of the alert that points here, or "manual">
- **Severity**: page | ticket · **Owner**: <team/person>
- **Last rehearsed**: <YYYY-MM-DD> | Unrehearsed
- **Access needed**: <what the responder must already have — check this first>

## Symptom

How it presents: what the alert says, what a user sees, what it is easy to confuse this with.

## Impact

Who is affected and how badly. Is it user-visible? Is data at risk? What is still working.

## First move — mitigate now

The one action that restores service without understanding the cause. Command, expected result, and how to confirm it worked.

```
<command>
```

## Checks, in order

1. **<what you are testing>** — `<command>`
   - Good: <what you should see>
   - Bad: <what it means, and the next step>

## Escalate

To <whom>, after <how long or which check fails>, with: the correlation id, what was tried, the timeline.

## Do NOT

- <destructive action that looks like progress>

## After

Service restored ≠ incident over. If the error budget was burnt or users were affected, run `/postmortem`.
</runbook-template>

## Never

- Invent a command, a namespace, a deployment name or a dashboard URL. Read it from the
  repo, or leave a marked blank for the human to fill.
- Put a credential, a token or a connection string in the file.
- Write a check whose outcome changes nothing.
- Explain the architecture. A runbook is a procedure; the reasoning lives in the ADRs.
- Let it grow past one screen — a second failure mode is a second runbook.
