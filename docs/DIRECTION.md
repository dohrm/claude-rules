# Direction

What this harness is for, and the grid every rule, check, skill and issue is
triaged against. When an asset does not serve a line below, it is a candidate for
removal, not for a fix.

## Who it is for

The maintainer and the team he works with, developing products for real. The
repository stays open source and unpromoted: it encodes one sensibility about
coding agents and does not try to impose it on anyone else.

- **Never optimise for a stranger.** Generality — another host, another workflow —
  earns its cost through a use inside the team.
- **The stack portfolio is deliberate.** Rust, Go, TypeScript (front and back),
  Tauri, Python, gRPC — and Godot C# — stay available so the team picks the best
  technology for the need. A stack is kept even when no project installs it today;
  its rules are trimmed and turned into checks, never retired for lack of use.
- **The benchmark is a team member who is not a developer** — a sysadmin, with an
  eye for IT, security and operability, but neither a developer nor a product
  owner. The harness works when that person ships a product without reading the
  code. Where they get stuck, the harness is wrong, not the person.
- **The harness is itself proved.** `eval/` replays an asset's behaviour after a
  model bump; a separate benchmark repository exercises the whole harness end to
  end on a real product.

## What the harness provides

**The means for an agent to obtain its proofs.** A proof is systemic: it does not
depend on an LLM run, it is deterministic, and it runs fast enough to sit inside
the agent's feedback loop. Gates, tests, mutation, the L4 referee.

| | Systemic | Not systemic |
|---|---|---|
| States the norm | checks in `kit/` | prose rules in `rules/` |
| Enforces it | gates — a **proof**, blocks | LLM review — a **signal**, blocks on `CRITICAL` only |
| Covers | correctness, regression, format | drift from the objective, architecture drift, security flaws, slop |

- **Prose is legitimate** to steer the context and to cover what is not yet
  systemic. Prose that duplicates an existing check is noise. Prose covering
  something a command could verify is a debt towards that check.
- **Review is the enforcement arm of prose.** A prose rule no reviewer can cite
  protects nothing.
- **A recurring review finding is a candidate check** — the ratchet. A finding never
  becomes a proof by promotion: it stays a signal until a check replaces it.
- **Authority comes from mechanism, not convention.** Host hooks (guards) are
  defence in depth and fail open; the referee, CI and forge branch protection are
  the authority, and they work the same under every host.

## Autonomy ceiling: L4

L4 — a tech lead working one RFC, escalating budget and scope — is the highest
level this repository implements. The autonomy a run reaches is bounded by how
verifiable its stopping condition is: a ceiling below L4 (for instance on-device
testing) names a missing proof, which the harness should help close.

**L5 lives outside this repository.** A manager-level proxy that allocates budget
across product objectives, answers L4 escalations and asks the human only product
questions is built elsewhere. This repository owns the **interface** it consumes:

- every escalation is **self-contained** — readable without the session that raised
  it: project, RFC and phase, class (`budget` | `scope` | `product`), three lines of
  context, one question, options with a recommendation, reversibility, the default
  if unanswered;
- escalations are **structured**, so one queue can collect them across projects and
  a human or a proxy can answer them;
- hard-checkpoint **approvals** (`ready`, an ADR status, a merge, a `**Stakes**`
  change) go through the same queue, as kind `approval`: no options, one decision;
- every escalation and its answer are **recorded by class**, so delegating a class
  rests on measured agreement, not on impression.

A decision that is local and reversible never reaches the human, at any level: it is
a `changed:` line the agent settles. An escalation that should have been one is a
classification defect.

## Hosts

| Now | Horizon |
|---|---|
| Claude Code, Codex | add Pi; retire Cursor |

No new investment in Cursor. A new guarantee is built host-independent when it can be,
so the horizon costs an emitter, not a rewrite.

## Out of scope

- L5 and anything above it — the manager proxy, cross-project budget allocation.
- Event-triggered runs (a tracker event launching an agent) — the factory, not the
  harness.
- Anything whose only user would be someone outside the team.
