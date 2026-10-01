---
name: solution-exploration
description: "Explore solutions to a product or architecture problem before consulting existing ADRs, then assess decision impacts. Use on /solution-exploration, a proposed new direction, or a reported limit of the current design. For initial architecture authoring, use /architect."
---

# Explore solutions without anchoring on past decisions

Work in two passes. Keep the first pass independent of existing ADRs, even when
the user names a current decision. An `Accepted` ADR describes what is in force;
its status is not evidence that the choice still serves the problem best.

## 1. Explore from the problem

Clarify the outcome, product needs, constraints and decision criteria. Inspect
relevant code, behavior and other evidence as needed, but **do not read or use
existing ADRs in this pass**. Develop credible options, including the user's
proposal and keeping the current design when relevant. Give each option its
strongest case, costs, risks and unknowns. Form a provisional recommendation from
this comparison; say what evidence could change it. A request to consider a new
project or direction deserves a genuine assessment, without presuming the current
path will win.

## 2. Reconcile with the decision record

Only after the options and provisional recommendation are clear, read
`agent/decisions.md` and the relevant ADRs. Follow dependent ADRs when an option
changes their assumptions or invariants; a shared authorization model, for
example, can affect many decisions. Compare the options against decisions in
force, original rationale, current evidence, migration costs, and conflicts that
would require new human arbitration. Do not reopen unrelated records. Revise the
recommendation if the ADRs reveal a real constraint or cost; explain any change
from the first pass. Never reject an option solely because an ADR is `Accepted`.

Hand back a concise, sourced comparison: criteria and assumptions, options and
their best arguments, provisional conclusion, ADR impacts, migration costs, final
recommendation and remaining uncertainty. Cite repository files and external
evidence used. Exploration alone does not require an ADR.

Do not implement a disruptive alternative, change the architecture contract, or
change an ADR status without a human decision on adoption. If a replacement is
chosen for proposal, read `agent/decision-records.md` and draft `Proposed` ADRs,
one per distinct decision. Explain what remains in force if the proposals are
declined. A human changes and commits `Accepted`, `Rejected`, `Superseded`, or
`Deprecated` status. Use `/architect` for initial architecture and its full
document set.
