# claude-rules

Reusable rules, skills and executable quality checks for coding agents. Install
only the profiles your project needs: language conventions, API architecture,
product preparation, local services and review.

The installer targets **Claude Code and Codex by default**, with Cursor optional.
Both use the same authored rules and skills. See [targets](docs/reference.md#targets).

## Start here

Requires Node.js 18+ and Git. Run from your project's root:

```bash
# Choose profiles and agents interactively.
npx github:dohrm/claude-rules add
npx github:dohrm/claude-rules init
npx github:dohrm/claude-rules doctor
```

The default level installs rules and skills. Use `--level gates` for executable
checks too. `init` creates missing scaffolding; follow the reported wiring steps
for existing files and install the tools your kit needs. Run `just check` once
wired. See the [kit setup](kit/README.md).

**Keep local changes outside generated rules.** Codex updates track owned files
and refuse conflicting local edits; Claude/Cursor rule directories are replaced. The kit is copied for adaptation. Review the diff after each
installation or update. Use `--ref <tag-or-commit>` to pin an asset revision.

## Pick your stack

Examples below use the new-install default, Claude and Codex. Select one with
`--agent claude` or `--agent codex`; Cursor remains available with `--agent cursor`.
Existing installations retain their selected agents. Replace the module paths with yours.

```bash
# Choose the API stack you use:
npx github:dohrm/claude-rules add rust-api --root apps/api --level gates
# Alternatives: go-api, python-api, ts-node-api

# Add a TypeScript web portal:
npx github:dohrm/claude-rules add ts-web-app --root apps/web --level gates

# Add shared checks, product skills and execution support as needed:
npx github:dohrm/claude-rules add agent testing cicd --level gates
npx github:dohrm/claude-rules add product loop-setup
npx github:dohrm/claude-rules add devstack --level gates
```

For a script or worker, start with `rust`, `go`, `python` or `ts` instead of an API
bundle. In a monorepo, `--root` scopes a profile to its module. `devstack` manages
local services when several processes must run together.

Aliases such as `rust-api` expand into elementary profiles before routing.
The lock records root profiles under `modules["."]`. Codex gets a short root
`AGENTS.md` plus one per module, linking applicable rules in `.agents/rules/`.
The root asks the agent to discover module guidance when work enters a directory;
this is explicit reading, not native dynamic rule loading. Local text outside the
managed blocks is preserved. See the [sharing contract](docs/agent-sharing.md).

Browse with `npx github:dohrm/claude-rules list`, or read the
[full profile catalogue](docs/reference.md#the-profile-catalogue).

## Work on a project

These are entry points, not mandatory stages. Skill names below use Claude's
slash-command notation.

| Need | Start with |
|---|---|
| Clarify a product or capability | `/prd`; `/interview` if the intent is still unclear |
| Choose or challenge architecture | `/architect`: compare alternatives, including the current design |
| Organize substantial work | `/plan` → `/tasks` → `/loop-setup`; pass `L2`/`L3` for fewer checkpoints (default `L1`) |
| Adjust behavior or UX | Discuss the target, implement, review and iterate; update the affected documents |
| Explore or retain a UI flow | `/experience`, scoped to the journey and actor being reviewed |
| Run a local monorepo | `devstack`; [setup and commands](kit/devstack/README.md) |
| Equip an existing repo / migrate an installation | `/onboard` / `/migrate` |

An accepted ADR governs implementation, but its rationale can be challenged.
Alternatives remain proposals until **you manually change and commit the ADR
status**. The agent does not accept or supersede decisions on your behalf.
Ordinary authorized adjustments update the affected product documents in place.

Other skills, including design-system, UI prompt export and incident workflows,
remain available in the [skill catalogue](docs/reference.md#the-commands-you-end-up-with).

## Check and review

After wiring the kit, use the same commands locally, in hooks and in CI:

```bash
just check                       # Formatting, lint, tests and wired document checks
just code-review                 # Independent review; Claude by default
just code-review codex           # Use Codex for the review
just review-with codex "Review the API boundaries"  # Targeted, ad hoc review
```

The review commands require the selected agent CLI to be installed and configured.
Git hooks run the wired checks and review guard. `adr-check` and `docs-check`
protect decision records and document consistency. See [review setup](kit/common/README.md).

Mutation runs in CI on pull requests; local execution is optional. The supplied
jobs start non-blocking while you establish a baseline, then become a ratchet.
See [testing and mutation](docs/reference.md#the-commands-you-end-up-with).

## Maintain an installation

```bash
npx github:dohrm/claude-rules list
npx github:dohrm/claude-rules doctor
npx github:dohrm/claude-rules budget apps/api/src/main.rs --agent codex
npx github:dohrm/claude-rules update --ref <tag-or-commit>
npx github:dohrm/claude-rules remove <profile>
```

To add Codex to an existing installation, repeat an installed profile explicitly:
`npx github:dohrm/claude-rules add rust --agent codex` (replace `rust` as needed).

Removal leaves your justfile and hook wiring for you to adjust.
[Installer reference](docs/reference.md#install) covers levels, roots and updates.

## Find the details

- [Reference: profiles, workflow, targets and commands](docs/reference.md)
- [Kit setup](kit/README.md) · [review and document gates](kit/common/README.md)
- [Prompting guide](guidelines/prompting.md) · [instruction layout](guidelines/claude-md-hierarchy.md)
- [Changes](CHANGELOG.md) · [agent evaluations](eval/README.md)

To contribute, edit the source assets and run `npm test`. Language-specific tests
need their toolchains and skip when unavailable. See
[verification](docs/reference.md#verifying-the-factory-itself) for details.
