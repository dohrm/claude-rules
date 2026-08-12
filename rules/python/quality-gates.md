---
paths:
  - "**/*.py"
title: "Python Quality Gates"
---

Before considering any change complete, the full local gate must pass:

```bash
just python-check     # runs: python-lint → types → tests → dependency audit
```

Python has **no compiler to fall back on**. Every guarantee `cargo build` or `tsc`
gives for free is, here, a tool someone has to run. That is why the gate is not
optional: skipping it does not cost you a warning, it costs you the type system.

## The gate, and what it replaces

| Gate | Command | Its counterpart elsewhere |
|---|---|---|
| Format | `ruff format --check` | `cargo fmt --check`, `gofmt` |
| Lint | `ruff check` | `clippy -D warnings`, `golangci-lint` |
| Types | `mypy --strict` | the Rust/Go compiler, `tsc --strict` |
| Tests | `pytest` | `cargo test`, `go test` |
| Lock freshness | `uv run --locked …` (or `uv lock --check`) | `cargo --locked`, `npm ci` |
| Vulnerabilities | `pip-audit` | `cargo deny advisories`, `govulncheck` |
| Unused deps | `deptry .` | `cargo machete` |

`python-lint` (format + lint) runs on pre-commit; `python-check` adds types, tests and the
audit on pre-push. Any failure is a build failure — a lint warning as much as a
red test.

## Suppressions

Same rule as Go's `//nolint` and TypeScript's `@ts-ignore`: a silenced check is a
gate you no longer have.

- No bare `# noqa` — always `# noqa: E501  # <why>`, with the code and a reason.
- No bare `# type: ignore` — always `# type: ignore[arg-type]  # <why>`. A bare
  form hides *every* error on the line, including the ones you never saw.
- Never loosen a `mypy` or `ruff` setting to make code pass. Fix the code, or
  argue the exception in the config with a comment next to it.

## mypy strictness

`--strict` from day one on new code (`disallow_untyped_defs`,
`warn_return_any`, `no_implicit_optional`…). On a legacy codebase, strictness is
**ratcheted per module** — a global `ignore_errors` that never shrinks is theatre.
Baseline the modules that fail, then move them one at a time, never enlarge the
list (see `testing/ratchet.md` for the same sequence applied to coverage).
