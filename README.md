# claude-rules

A personal library of reusable Claude Code assets — rules, skills, and guidelines — built up across projects and meant to be shared.

## Goals

- Centralize rules written across multiple projects into a single source of truth
- Provide a reusable foundation: import rules directly into any project via `@`
- Serve as a reference and onboarding base for team members working with Claude Code

## Structure

```
claude-rules/
├── rules/                    # Reusable rule files (@-importable in any CLAUDE.md)
│   ├── language.md           # Language split: artifacts in English, communication in preferred language
│   ├── architecture/
│   │   ├── hexagonal.md             # Hexagonal architecture: dependency direction, domain purity, trait pattern
│   │   ├── cqrs.md                  # CQRS / Event Sourcing: flow, aggregate pattern, query/QueryBuilder split
│   │   └── frontend-flat-domain.md  # Frontend modular portal: ui/features/core/pages, dependency rules
│   ├── rust/
│   │   ├── code-style.md     # Naming, control flow, ownership, async, serde
│   │   ├── error-handling.md # thiserror/anyhow usage, unwrap rules, propagation
│   │   ├── logging.md        # tracing levels, secrets, structured fields, #[instrument]
│   │   └── quality-gates.md  # cargo build/test/clippy/fmt
│   ├── go/
│   │   ├── quality-gates.md          # go build / staticcheck / go test
│   │   └── hexagonal-packaging.md    # core/infra/pkg layout, dependency rule
│   ├── react/
│   │   └── portal.md         # OpenAPI gen, TanStack Query, portal context (user/locale/theme)
│   └── leptos/
│       ├── patterns.md       # Resource/Suspense, StoredValue, spawn_local, server functions
│       ├── gotchas.md        # Children/ChildrenFn, For syntax, compilation quirks, WASM safety
│       └── portal.md         # SSR-first, shared crate types, cookie-based app state (exploratory)
├── skills/                   # Custom skill definitions for Claude Code
└── guidelines/               # Patterns and recommendations for working with Claude Code
    └── claude-md-hierarchy.md
```

## Usage

The recommended approach is to add this repository as a git submodule:

```bash
git submodule add https://github.com/dohrm/claude-rules .claude/claude-rules
```

Then reference rules from your project's `.claude/rules/` files:

```markdown
@.claude/claude-rules/rules/language.md
@.claude/claude-rules/rules/rust/quality-gates.md
@.claude/claude-rules/rules/architecture/hexagonal.md
```

See [`guidelines/how-to-use-rules.md`](./guidelines/how-to-use-rules.md) for per-technology setup examples.

## Guidelines

See [`guidelines/`](./guidelines/) for documented patterns on topics such as:

- [How to use these rules in a project](./guidelines/how-to-use-rules.md)
- [CLAUDE.md hierarchy in multi-module projects](./guidelines/claude-md-hierarchy.md)
