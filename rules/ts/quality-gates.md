---
paths:
  - "**/*.ts"
  - "**/*.tsx"
title: "TypeScript Quality Gates"
---

Before considering any change complete, the full local gate must pass:

```bash
just ts-check     # runs: lint → test → build (the kit's ts-lint + tests + tsc build)
```

`ts-lint` (ESLint, `js.recommended` + `typescript-eslint.recommended`) runs on
pre-commit; `ts-check` adds tests and the type-checking build on pre-push. Any
lint warning, failing test, or type error is a build failure. Do not skip a gate.

## TypeScript strictness

- `tsconfig` runs in **`strict` mode** (`strictNullChecks`, `noImplicitAny`…).
  Never loosen a compiler flag to make code pass — a disabled check is a gate you
  no longer have.
- **No `any`.** Use `unknown` + narrowing, generics, or a precise type. `any` is
  allowed only at an untyped boundary (3rd-party without types) and only with a
  justification comment on the same line.
- **No non-null `!` to silence the compiler.** Model nullability explicitly and
  narrow it. `!` is acceptable only where an invariant is genuinely unprovable to
  the checker, with a comment stating why.
- No `@ts-ignore` / `@ts-expect-error` / `eslint-disable` without an explicit
  justification comment on the same line (same rule as Go's `//nolint`).

## Generated code

Code generated from a contract (OpenAPI client, router tree, `**/*.gen.ts`) is
**never hand-edited or hand-linted** — it is rewritten on each codegen run. It is
in the ESLint `globalIgnores`; regenerate instead of patching.

## Testing conventions

- Test **behavior through the public API**, not implementation details.
- Prefer deterministic tests over mocked complexity; a test that only asserts
  construction, or a mock returning a mock, is not a test.
- Co-locate unit tests (`foo.test.ts` next to `foo.ts`); keep integration tests
  in a dedicated dir.
