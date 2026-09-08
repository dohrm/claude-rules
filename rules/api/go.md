---
paths:
  - "**/*.go"
title: "HTTP API — Go (chi + Huma)"
---

**chi** for routing/middleware + **Huma** for an OpenAPI-first layer generated from
Go structs and tags. Passthrough, the DTO reasons, leak, problem+json and
versioning: `api/principle.md`.

`just go-check` owns golangci / test / govulncheck. It does not see a handler
outside `huma.Register`, nor a leaked field on a json-tagged struct.

## Stack

- **chi** — lightweight router + `middleware` stack (RequestID, RealIP, Recoverer, Timeout).
- **Huma** — operation registration with typed input/output structs; generates OpenAPI 3.1 and validates requests against it. Mount Huma on the chi router (`humachi.New`).
- Serve the spec at `/openapi.json` — the frontend generator reads it — and, in non-prod, the built-in docs UI.

## Rules

- Register operations via `huma.Register` with explicit input/output structs — validation and OpenAPI both come from the struct tags (`json`, `path`, `query`, `required`, `doc`). A hand-rolled `http.HandlerFunc` outside Huma is a bug.
- **The `json` tags on a struct are the marker that it is wire-facing.** That is what to audit on every change (`api/principle.md` — leak is deny-by-default). Passthrough means the service's type goes in the Huma output `Body` directly.
- Errors use the `huma.Error*` helpers, rendered in the shared problem+json shape (`backend/errors.md`).
- Dependencies are passed explicitly to handler constructors (closures over the app container) — no package-level globals.

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
