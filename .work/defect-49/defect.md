# Bug — the React eslint overlay fails on a fresh install of current packages

- **Status**: diagnosed
- **Autonomy**: L3
- **Repository**: https://github.com/dohrm/claude-rules
- **Base branch**: next
- **Branch**: fix/defect-49
- **Ticket**: https://github.com/dohrm/claude-rules/issues/49

## Symptom

Following `kit/ts-web/README.md`'s install block, then copying `eslint.react.js`:

```
npm error ERESOLVE unable to resolve dependency tree
npm error peer eslint@"^3 || ^4 || ^5 || ^6 || ^7 || ^8 || ^9" from eslint-plugin-jsx-a11y@6.10.2
```

and, with eslint pinned to 9 to get past it, `npx eslint .`:

```
A config object has a "plugins" key defined as an array of strings.
Flat config requires "plugins" to be an object
```

## Expected behavior

The README's install block, then the copied overlay, gives a working `eslint .` — source:
`kit/ts-web/README.md` § Configs (the install block and "copy once"), `kit/ts-tauri/README.md`
("Same React overlay as ts-web"), and `test/ts-gates.test.mjs`, which runs both overlays.

## Reproduction

- Command: in a scratch dir, the README's `npm i` lines, copy `kit/ts-web/eslint.react.js`
  to `eslint.config.js`, `npx eslint .`. In the repo: `TS_GATES=1 node --test
  test/ts-gates.test.mjs` with the witness at `eslint-plugin-react-hooks@^7`.
- Fails on: `fc1f4f4` with the two errors above (eslint 10.13.0 / 9.39.5,
  react-hooks 7.1.1, jsx-a11y 6.10.2).

## Hypotheses

1. react-hooks v7 made `configs['recommended-latest']` the legacy config and moved the flat
   one to `configs.flat` — if true: on 7.1.1 `configs['recommended-latest'].plugins` is an
   array and `configs.flat['recommended-latest']` exists; if false: an object →
   **confirmed**: keys `[recommended, recommended-latest, flat]`, `plugins` is an array,
   `flat` holds `[recommended-latest, recommended]`.
2. The README installs eslint unpinned, so npm picks 10, which jsx-a11y 6.10.2's peer range
   refuses — if true: ERESOLVE on the README's second line; if false: it installs →
   **confirmed**: ERESOLVE, eslint 10.13.0 resolved by the first line.
3. The kit's own gate cannot see either, because the witness lock pins react-hooks 5.2.0
   and eslint 9 — if true: the fixture lock has 5.2.0 / 9.x; if false: 7.x →
   **confirmed** (contributing, not causal): `test/fixtures/ts-gate` locks
   react-hooks 5.2.0, eslint 9.39.5. The witness tests a version the README never installs.

## Root cause

`kit/ts-web/eslint.react.js` and `kit/ts-tauri/eslint.react.js` read
`reactHooks.configs['recommended-latest']`, the legacy shape since react-hooks v7; and
`kit/ts-web/README.md`'s install block leaves eslint unpinned while jsx-a11y 6.10.2 caps
it at 9. The witness (`test/fixtures/ts-gate/package.json`, `^5.2.0`) hid both.

## Assumptions

- Autonomy L3 — passed at launch.
- The witness moves to react-hooks `^7` — the version the README installs; a witness on
  an older major tests nothing a consumer runs.
- eslint pinned at 9 in the README until jsx-a11y supports 10 — the reporter's fix; the
  pin is the README's, the floor `kit/ts` is not touched (no jsx-a11y there).

## Blocked on the human

## Log

- phase 1–3: both symptoms reproduced in a scratch app with current packages; the three
  hypotheses checked against installed 7.1.1 and the fixture lock.
