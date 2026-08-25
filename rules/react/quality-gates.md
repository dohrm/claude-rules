---
paths:
  - "**/*.tsx"
title: "React Quality Gates"
---

React is TypeScript — the language gate applies (`just ts-web-check` or
`just ts-tauri-check`; a shared package uses `just ts-check`). Rules of
Hooks and the a11y floor (roles / labels) are `eslint-plugin-react-hooks`
+ `eslint-plugin-jsx-a11y` in those recipes.

What they do not decide:

- Components are pure during render. **Derive, don't sync** — do not
  mirror props into state via an effect.
- Stable list keys are a domain id, never the array index for a dynamic
  list.
- Do not fetch data in `useEffect` by hand — go through the app's
  server-state layer. Raw `fetch` + `useEffect` for data is a review
  blocker.
- Test with React Testing Library: query by role/label, assert
  user-visible behavior. jsx-a11y does not force RTL.
