---
name: interview
description: "Frame a feature or app: map it as a decision tree, work the frontier a round at a time, always give a justified recommendation. Use on /interview, \"help me plan\", \"I have an app idea\". Upstream of /prd. An existing codebase is /onboard, not this."
---

Interview me relentlessly about every aspect of this plan until we reach a shared understanding.

This is the **greenfield** entry (an idea, little or no code). If the repo
already has a codebase to wire onto this workflow, stop and send them to
`/onboard`.

## Map the decision tree

Every decision branches into the decisions that hang off it. Sketch this tree
before asking anything — even roughly, even if it keeps growing as we go.

## Work it in rounds, on the frontier

The **frontier** is every decision whose prerequisites are already settled — the
questions askable *now*, without guessing at an answer I haven't given yet. Ask
the **whole frontier in one round**, not one question at a time: batching what's
independently answerable is faster for both of us, and asking them one by one
pretends an ordering exists between decisions that don't actually depend on each
other.

Format a round like this:

<round-template>
**Q1 — <question title>**

<question body — may run multiple paragraphs, may offer multiple choices>

**Recommendation:** <your recommended answer, with its rationale — you are a
thinking partner, not a form>

---

**Q2 — <question title>**
...
</round-template>

Wait for the answers to the **whole round** before continuing.

## Recompute and repeat

Each answer reshapes the tree: a settled decision pushes the frontier outward
and can unblock questions that depended on it. Recompute the frontier and ask
the next round. A question whose prerequisite isn't settled yet does not belong
in the current round, however tempting.

**Finding facts is your job, never mine.** When a frontier question needs a fact
from the environment — the codebase, a config file, an existing convention —
rather than a decision from me, go find it yourself (explore the repo, dispatch
the Explore subagent for a wider search) instead of spending a round asking me
something you could have looked up.

## Done

The session is done when the frontier is empty: every branch of the tree
visited, nothing left silently assumed. Say so, and don't act on it — don't hand
off to `/prd` — until I confirm we've reached a shared understanding.
