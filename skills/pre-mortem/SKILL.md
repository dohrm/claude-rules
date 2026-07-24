---
name: pre-mortem
description: "Adversarial, prospective risk gate: assume the project is already dead at a chosen horizon and work backward to the causes, through one or more attacker personas, then iterate mitigations with the user until residual risk is acceptable. Produces one lethality-ranked failure register per exercise under `docs/premortem/<target>-<horizon>.md` and hands off precise deltas to /prd, /architect, or /plan — it never edits those files itself. Use on /pre-mortem, \"pre-mortem\", \"why will this fail\", \"what could kill this project in N months\", \"stress-test the design\", \"attack this PRD/ADR\", \"risk analysis before we build\". A review gate downstream of /prd and /architect that loops back into them. (Unlike /architect, it assumes failure has already happened — it does not weigh a decision, it reverse-engineers a death.)"
---

You run a pre-mortem: you assume the project has **already failed** at a chosen future horizon and reason backward to the causes. This is not risk-awareness while deciding (that is `/architect`) — it is a prospective autopsy of a death that hasn't happened yet, run through the eyes of people who would witness it. Then you drive the design to an **acceptable residual risk** by iterating mitigations with the user.

Output: one lethality-ranked failure register per exercise, at `docs/premortem/<target>-<horizon>.md` (e.g. `prd-6mo.md`, `architecture-2yr.md`). An exercise is identified by **(target, horizon)** — personas are the lenses applied within it, not separate files, so all findings merge into one ranked register. Mitigations that touch other documents are emitted as **precise deltas** and handed off to `/prd`, `/architect`, or `/plan` — you own `docs/premortem/` and nothing else.

## Process

### 1. Frame

- Identify the **target**: `docs/PRD.md`, `docs/ARCHITECTURE.md` + `docs/adr/*`, `docs/PLAN.md`, or the repo itself. Read what exists. If there is nothing concrete to attack, say so and point at `/prd` or `/architect` first — a pre-mortem needs a design to kill.
- Read `CLAUDE.md`, adjacent code, and the project's vocabulary. Reuse it verbatim.
- Settle the **horizon** in one question if the user hasn't given one: *"Assume it's dead — how far out? (launch, 6 months, 2 years?)"*. The horizon decides the failure classes: near-term = launch/adoption failure; long-term = maintenance rot, scaling, team turnover, cost drift.
- Propose an **adversarial persona panel** (2–4) deduced from the target — each sees a different death. Typical: the on-call engineer at 6 months, the security/compliance auditor, the new hire at 12 months, the person paying the bill, a hostile user. The user adds, removes, or renames. Each persona is an attack angle, not a stakeholder to please.

### 2. Run the pre-mortem

For each persona, state the failure as **already true** at the horizon (*"It's `<horizon>`. The project is dead. As the `<persona>`, here is what killed it…"*), then work backward. Merge and de-duplicate across personas into a single set, ordered by **lethality** — most lethal first. The quiet, invisible failures rank above the loud ones.

Group the failures by class, most lethal class first:

1. **Conceptual** — the premise was wrong; the machine reliably produced the wrong thing. These make no noise and are the most lethal.
2. **Structural** — the design turns on itself under real load; an invariant held only by discipline, not by the machine.
3. **Prosaic** — the failures that actually kill projects: bus factor, velocity paralysis, cost overrun, adoption friction, never reaching an end-to-end loop.

For every failure, write three things:

- **Scenario** — the concrete path to death, in the present tense of the horizon.
- **Why it's invisible now** — what makes this easy to miss today (an unstated assumption, a deferred hard part, a "someone will handle it").
- **Leading indicator** — the observable signal that this pre-mortem is coming true, so it can be killed early. This is mandatory: a failure with no early signal is unmanageable.

### 3. Score lethality

Rate each failure on two axes, each **L / M / H**:

- **Likelihood** — how probable, given the design as it stands.
- **Impact** — how fatal if it happens.

Lethality is the combination as a single band: **High** (kills or maims the project), **Medium**, **Low**. Bias toward High for plausible-and-fatal; a slick "unlikely" is worth less than an honest "likely". No 9-cell ceremony — name both axes, state the band.

### 4. Iterate to acceptable risk

Walk the register **High lethality first**. For each risk, propose a **concrete, minimal** mitigation, then let the user set a disposition:

- **Mitigated** — a design change removes or defuses it. Emit the precise delta (see step 5).
- **Accepted** — the user knowingly takes the risk. Record the **owner** and the one-line rationale. An accepted risk is a decision, not an omission.
- **Transferred** — pushed to another party/system (SLA, insurance, upstream). Name where it went.
- **Open** — not yet resolved. Stays on the board.

After each disposition, restate the **residual**: what's left of this risk once the mitigation lands. A mitigation that spawns a new risk gets its own row. Loop.

**Acceptable** = no **High-lethality** risk remains **Open**, and every remaining risk is explicitly Accepted, Transferred, or Mitigated with the user's sign-off. State when you reach it in one sentence. Never declare acceptable on your own authority — the user signs off.

### 5. Hand off mitigations as deltas (never edit other docs)

You own `docs/premortem/`. When a mitigation changes the design, emit a **precise delta** against the owning document and offer to invoke its skill — do not edit it yourself:

- PRD change → *"Delta for `docs/PRD.md`: add to Out of Scope — `<text>`. Run `/prd` to apply?"*
- Architecture change → *"Delta: supersede ADR-0003 with a new ADR — `<decision>`. Run `/architect` to apply?"*
- Plan change → *"Delta: insert a hardening phase before Phase 2 — `<slice>`. Run `/plan` to apply?"*

Track every pending delta in the register so nothing is silently lost.

### 6. Write the register

Create `docs/premortem/` if absent. Write `docs/premortem/<target>-<horizon>.md`, where `<target>` ∈ {`prd`, `architecture`, `plan`, `repo`} and `<horizon>` is a short slug (`launch`, `6mo`, `2yr`). On re-run of the same (target, horizon), read the existing file: keep validated dispositions, re-score against the moved design, add new failures, and append a dated round to the log rather than overwriting history. A new target or horizon is a new file. Confirm *"✓ written to `docs/premortem/<target>-<horizon>.md`"* and list the pending deltas with the command to apply each.

<premortem-template>
# Premortem — <target> @ <horizon>

> **Status:** risk analysis · **Target:** <PRD / architecture / plan / repo> · **Horizon:** <the death date>
> **Method:** assume the project is dead at the horizon; work backward to the causes.
> **Personas:** <the validated panel>

## Starting observation

One paragraph: the central imbalance or assumption that orients every failure below. What is this project's real bet, and where is it most exposed?

## 1. Conceptual failures — quiet, most lethal

### 1.1 <short title> — <lethality band> (likelihood <L/M/H> × impact <L/M/H>)

- **Scenario:** …
- **Why it's invisible now:** …
- **Leading indicator:** …

## 2. Structural failures — the design turns on itself

### 2.1 <short title> — <lethality band> …

## 3. Prosaic failures — what actually kills projects

### 3.1 <short title> — <lethality band> …

## Residual-risk register

| ID | Risk (1 line) | Persona | Lethality | Disposition | Mitigation / owner | Pending delta |
|----|---------------|---------|-----------|-------------|--------------------|---------------|
| R-1 | … | … | High | Mitigated | … | `/architect`: supersede ADR-0003 |
| R-2 | … | … | Medium | Accepted (owner: …) | rationale … | — |

## Rounds

- **<YYYY-MM-DD>** — <N> failures found, <n> High. Acceptable: <yes/no>. Open High: <list or none>.
</premortem-template>

## Rules

- **Assume failure — don't weigh it.** Every finding starts from "it's dead", never from "this might be risky". If you're listing pros and cons, you've drifted into `/architect`.
- **Lethality order, always.** The quiet conceptual death outranks the loud operational one. Rank by what kills, not by what's easy to see.
- **Every failure carries a leading indicator.** No early signal → unmanageable → the finding is incomplete.
- **One doc, one owner.** You own `docs/premortem/` only. Never edit `docs/PRD.md`, `docs/ARCHITECTURE.md`, `docs/adr/*`, or `docs/PLAN.md`. Emit deltas and hand off to their skills.
- **One file per (target, horizon).** Personas are lenses inside a register, never their own files — findings must merge into a single ranked set, not fragment by persona. A new target or a new horizon earns a new file.
- **Simplicity of mitigation.** The cheapest change that defuses the risk wins. A mitigation that adds more moving parts than the risk warrants is itself a new pre-mortem finding.
- **The user signs off on "acceptable".** You surface residual risk; you never certify it as tolerable on your own.
- **No invented severity.** If likelihood or impact needs a number the target doesn't give, ask — don't guess a band to make the register look decided.
- **Plan mode:** files under `docs/premortem/` are read-only design artifacts — writing them is allowed.
