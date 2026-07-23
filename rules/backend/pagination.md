---
paths:
  - "**/*.rs"
  - "**/*.go"
  - "**/*.ts"
title: "Backend — Pagination, Sorting & Filtering"
---

List endpoints are paginated by default and share one convention across the API. A list endpoint that returns everything is a bug waiting for production data.

## Pagination

Default to **offset/limit** for portal-style UIs (page numbers, jump-to-page):

- Query params: `skip` (offset, default `0`) and `limit` (default `20`, hard max e.g. `100`).
- Clamp `limit` to the max server-side — never trust the client to be reasonable.
- Response envelope carries the data plus the total, so the UI can render page counts:

```json
{ "items": [ /* ... */ ], "total": 1234, "skip": 0, "limit": 20 }
```

Use **cursor/keyset** pagination instead when the dataset is large or mutates under the reader (infinite scroll, feeds): opaque `cursor` in, `nextCursor` out. Pick one style per resource and document it in the OpenAPI schema.

## Sorting & filtering

- **Sort**: a `sort` param with an explicit allowlist of fields (`sort=createdAt:desc`). Reject unknown fields — never interpolate a client string into a query.
- **Filter**: explicit, typed query params per resource (`status=active`). No generic "query language" over the wire.
- Filtering/sorting are translated to the store in the infrastructure layer (see `hexagonal` / CQRS `QueryBuilder`) — the domain query struct stays plain data.

## Rules

- Every collection endpoint paginates; `limit` has a server-enforced maximum.
- Sort/filter fields are allowlisted, never free-form passthrough to the database.
- The pagination style (offset vs cursor) is consistent per resource and visible in the OpenAPI spec.

## Checklist

- [ ] List endpoints default to `skip`/`limit` with a clamped max
- [ ] Response carries `total` (offset mode) or `nextCursor` (cursor mode)
- [ ] Sort/filter fields are allowlisted and typed
- [ ] Query translation lives in infrastructure, not the domain
