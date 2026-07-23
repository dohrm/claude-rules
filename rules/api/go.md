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
- Input/output structs are DTOs in the adapter layer — never expose domain entities on the wire (keep the hexagonal boundary).
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
- [ ] Wire DTOs are distinct from domain entities
- [ ] Errors go through the shared problem+json contract
- [ ] OpenAPI JSON is served and reachable by the frontend generator
- [ ] Routes are versioned (`/api/v1`)
