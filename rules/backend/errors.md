---
paths:
  - "**/*.rs"
  - "**/*.go"
  - "**/*.ts"
title: "Backend — API Error Contract (problem+json)"
---

Every HTTP error crossing the wire uses **RFC 9457 `application/problem+json`**. One shape, everywhere — the frontend and any consumer parse errors once.

## The shape

```json
{
  "type": "https://errors.example.com/validation",
  "title": "Invalid request",
  "status": 422,
  "detail": "email must be a valid address",
  "instance": "/api/v1/users",
  "errors": [{ "field": "email", "message": "must be a valid address" }]
}
```

- `type` — a stable URI identifying the error class (not the occurrence). Dereferenceable is nice, stable is mandatory.
- `title` — short, human, stable per `type`.
- `status` — matches the HTTP status.
- `detail` — human, occurrence-specific.
- `errors[]` — the one sanctioned extension, for field-level validation failures.

## Rules

- **One central error handler** maps internal errors → problem+json. Handlers never format errors ad-hoc.
- Map by category, not by call site: validation → 422, unauthenticated → 401, forbidden → 403, not found → 404, conflict → 409, unexpected → 500.
- **Never leak internals** in `detail`: no stack traces, no SQL, no secret values. Log those server-side (see `logging`), return a correlation id instead.
- A `500` carries a generic `title`/`detail` + the correlation id — the cause lives in the logs, not the response.
- Domain errors are typed at the boundary (see `hexagonal` — ports use typed errors); the mapping to HTTP happens once, in the adapter layer.
- Set the `Content-Type: application/problem+json` header.

## Checklist

- [ ] A single error-mapping layer produces every error response
- [ ] Errors are categorized to the right status, not defaulted to 400/500
- [ ] No stack trace / SQL / secret ever reaches `detail`
- [ ] 5xx responses carry a correlation id also present in the logs
- [ ] `Content-Type` is `application/problem+json`
