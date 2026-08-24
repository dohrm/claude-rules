---
name: onboard
description: "Brownfield entry: inventory an existing repo, scaffold the docs hierarchy, cadrage for /architect. Use on /onboard, \"this repo already has code\", \"wire claude-rules on a brownfield\". Twin of /interview (greenfield). Does not write ADRs or a PRD."
---

You are onboarding **an existing codebase** onto this workflow. There is already
code. There is not yet a product chain (`docs/PRD.md`, `docs/adr/`, the living
index). Your job is to see what is there, write that down, and hand off. You are
not inventing a product and you are not choosing a stack.

`/interview` is the greenfield twin (an idea, little or no code). If this repo
is empty or the user is starting from a sentence, stop and send them there.

## What you never write

- **No ADR.** Status lines, `Proposed`, `docs/adr/` — that is `/architect`.
- **No PRD.** Capabilities, success criteria — that is `/prd`, fed by the
  inventory you produce, not by you filling the template.
- **No `claude-rules add`** without the user's go-ahead. Print the command.

## Process

### 1. See what is already there

Explore, do not interview first. Tree, manifests (`Cargo.toml`, `go.mod`,
`package.json`, `pyproject.toml`, `*.csproj`), existing `CLAUDE.md` /
`AGENTS.md`, `docs/`, CI, deploy. Use the Explore subagent for a wide search.

Settle four facts, as observations not recommendations:

- **Languages and layouts** — which trees, which are load-bearing.
- **How it runs** — tests, CI, deploy, or the honest "none yet".
- **What is already decided** — libraries, boundaries, auth, stores. Quote
  the file, do not re-decide.
- **What is missing** — no tests, no CI, no docs, a `README` that lies.

If a question is still unanswered after the tree, ask **one** question.

### 2. Cadrage (not architecture)

Shape, in one line: **backend / frontend / fullstack / gamedev / something
else**, and why the tree says that. Brownfield: **respect existing choices**.
A change is a migration with a cost, named, not a rewrite.

Observed capabilities — a list the later `/prd` can turn into units. Names
the code uses, not product-speak you invented. This is an inventory, not a
spine.

### 3. Write the hand-off

Create `.work/` if needed. Write **`.work/onboard.md`** (working memory,
gitignored in repos that followed `init`; say so if it is not). Shape:

```
# Onboard — <repo name>

## As-built
## Observed capabilities
## Shape
## Proposed claude-rules command
## Hand-off
```

The command uses **aliases**, **`--root`**, and **`--level gates`** — never
the old seven-profile bag on one language tree. Typical:

```
npx github:dohrm/claude-rules add rust-api agent --root apps/api --level gates
npx github:dohrm/claude-rules add testing cicd
```

Print it. Do not run it.

If `CLAUDE.md` is absent and Claude is a target, you may **scaffold** one
from what you observed (modules table, nothing else). That file is
committable. You do not fill `docs/`.

### 4. Hand off

- Product undocumented → `/prd` reads the observed-capability list.
- Stack decisions still open (or a migration to propose) → `/architect`.
- Workflow already matches the as-built → stop. The add command is the
  deliverable.

Confirm what you wrote (`.work/onboard.md`, and `CLAUDE.md` only if you
scaffolded it) and that **no ADR and no PRD** were created.
