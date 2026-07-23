---
paths:
  - "**/*.go"
title: "HTTP API — Go (chi + Huma)"
---

Opinionated default for a Go HTTP API: **chi** for routing/middleware + **Huma** for an OpenAPI-first layer generated from Go structs and tags. The OpenAPI document is the contract the frontend generates its client from — it is not optional.

## Stack

- **chi** — lightweight router + `middleware` stack (RequestID, RealIP, Recoverer, Timeout).
- **Huma** — operation registration with typed input/output structs; generates OpenAPI 3.1 and validates requests against it. Mount Huma on the chi router (`humachi.New`).
- Serve the spec (`/openapi.json`) and, in non-prod, the built-in docs UI.

## Rules

- Register operations via `huma.Register` with explicit input/output structs — validation and OpenAPI both come from the struct tags (`json`, `path`, `query`, `required`, `doc`). A hand-rolled `http.HandlerFunc` outside Huma is a bug.
- **Default to passthrough — don't mint a DTO that duplicates the type your service/query already returns.** That type is usually already consumption-shaped: put it in the Huma output `Body` directly and accept the request/command type directly as input. With a generated, type-checked client, a domain rename that ripples to the wire is a compile error in the same build — not a contract you must insulate by hand.
- **Introduce a distinct wire DTO only when the wire must diverge from that returned type**, for one concrete reason: (1) a field must not reach the wire (secrets, internal flags) — a hard security boundary; (2) a deprecated shape must be held through a data-migration window; (3) the wire has consumers that do not recompile in lockstep (public API, third-party, separately-shipped mobile). Absent one of these, the DTO is ceremony. When you do map, keep it trivial, never a field-by-field copy that can silently drop a field.
- **Leak is deny-by-default.** Because passthrough is the default, the moment a serialized type gains a field that must not be public, split off a DTO **in the same change** — never let a field reach the wire by accretion. The `json` tags on a struct are the marker that it is wire-facing: audit its fields on every change.
- Errors map to the shared error contract — see `backend/errors.md` (problem+json). Use `huma.Error*` helpers; do not invent per-handler shapes.
- Dependencies are passed explicitly to handler constructors (closures over the app container) — no package-level globals.
- Version the API under a path prefix (`/api/v1`).

## Shape

```go
type GetUserInput struct {
    ID string `path:"id" format:"uuid"`
}
type GetUserOutput struct {
    Body UserDTO
}

huma.Register(api, huma.Operation{
    OperationID: "get-user", Method: http.MethodGet, Path: "/api/v1/users/{id}",
}, func(ctx context.Context, in *GetUserInput) (*GetUserOutput, error) {
    // ...
})
```

## Checklist

- [ ] Every operation is registered via `huma.Register` with typed input/output
- [ ] The type your service returns goes in the Huma `Body` directly; no infra/DB type appears on the wire
- [ ] A DTO exists only where the wire must diverge (hidden field / deprecation window / non-lockstep consumer) — no DTO that duplicates the returned type 1:1
- [ ] Every wire-facing struct's fields were re-audited this change — no internal field leaked by accretion
- [ ] Errors go through the shared problem+json contract
- [ ] OpenAPI JSON is served and reachable by the frontend generator
- [ ] Routes are versioned (`/api/v1`)
