---
paths:
  - "**/*.rs"
  - "**/*.go"
  - "**/*.ts"
title: "Backend — Config & Secrets"
---

Config comes from the environment (12-factor). It is **loaded once, validated at startup, and injected** — never read ad-hoc from deep in the code.

## Rules

- **Parse once, at the edge.** A single typed config struct is built at startup from env vars, validated, then passed down through DI. No `env::var(...)` / `os.Getenv(...)` / `process.env` scattered in business code.
- **Fail fast.** A missing or malformed required variable aborts startup with a clear message naming the variable — never boot half-configured, never silently fall back to a default for a required secret.
- **Secrets are values, not literals.** No secret in source, in the repo, or in a committed `.env`. Ship a `.env.example` with keys and dummy values only.
- **Never log a secret** — log the key name, never the value (see `logging`). Redact secrets in any config dump.
- **Defaults are for non-secrets only** and must be safe for local dev. Production-only values (DB URL, signing keys) have no default.
- Distinguish required vs optional explicitly in the config type; optional carries its default at the definition site.

## Per-language note

- **Rust** — a `Config` struct deserialized via `serde` + `envy`/`figment`; validated in `Config::from_env()`.
- **Go** — a `Config` struct via `env`/`envconfig`; validated in `LoadConfig()`.
- **Node** — a schema (TypeBox/Zod) parsed from `process.env` at boot; `@fastify/env` if using Fastify.

## Checklist

- [ ] One typed config, built and validated at startup
- [ ] Missing/invalid required var → hard fail naming the var
- [ ] No `getenv`-style reads outside the config loader
- [ ] No secret in source or committed env files; `.env.example` present
- [ ] Secrets never logged; redacted in dumps
