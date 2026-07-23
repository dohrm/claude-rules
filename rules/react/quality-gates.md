---
paths:
  - "**/*.tsx"
title: "React Quality Gates"
---

React is TypeScript — the language gate applies (`just ts-check`; see TypeScript
Quality Gates). These are the additional framework gates, enforced by
`eslint-plugin-react-hooks` (Rules of Hooks) in `ts-lint`. Adopt them whenever
React is used, independent of the app's data architecture.

## Hooks

- **Rules of Hooks are non-negotiable** — hooks at the top level only, never in
  conditions, loops, or after an early return. The lint rule is a hard gate.
- Every effect with subscriptions/timers/listeners **returns a cleanup**.
- **Exhaustive deps**: don't silence `react-hooks/exhaustive-deps` — fix the
  dependency array or restructure. A disabled dep check hides stale-closure bugs.

## Components

- Components are **pure during render**: no side effects, no mutation of props or
  external state while rendering. Side effects live in event handlers or effects.
- **Derive, don't sync.** Compute values during render from props/state; do not
  mirror props into state via an effect. Effects that just copy state are a smell.
- **Stable list keys** — a domain id, never the array index for dynamic lists.
- Don't fetch data in `useEffect` by hand — go through the app's server-state
  layer (e.g. generated query hooks). Raw `fetch` + `useEffect` for data is a
  review blocker.

## Testing & accessibility

- Test with **React Testing Library**: query by role/label and assert on
  user-visible behavior, never on component internals or state.
- Use semantic elements and accessible roles/labels; interactive elements must be
  reachable and labelled. Accessibility regressions are gate failures, not polish.
