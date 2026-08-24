---
paths:
  - "**/*.py"
title: "HTTP API — Python (FastAPI + Pydantic)"
---

Opinionated default for a Python HTTP API: **FastAPI** for routing + **Pydantic v2**
for the types that generate the OpenAPI spec. The OpenAPI document is the contract
the frontend generates its client from — it is not optional.

`just python-check` owns ruff / mypy / pytest. It does not see a route without a
return annotation, nor a leaked field on a Pydantic model, nor problem+json
(FastAPI's default error body is `{"detail": …}`).

## Stack

- **FastAPI** — router, `Depends`, lifespan, OpenAPI 3 from the type hints.
- **Pydantic v2** — wire types. Parse once at the edge; the annotation *is* the schema.
- **uvicorn** — the ASGI server (composition root runs it).
- Serve the spec (`/openapi.json`) and, in non-prod, the built-in Swagger UI (`docs` path).

This is the **backend** Python profile — distinct from a worker or a script.
Add `python-api` (or `api` + `backend` + `hexagonal`) for an HTTP service.

## Rules

- Every route is a FastAPI/`APIRouter` handler with typed parameters **and** a
  return annotation (or `response_model` — see DTO below). A raw Starlette
  `Route`, a `dict` return, or `-> None` on a 200 that has a body is a bug, not
  a shortcut. OpenAPI and validation both come from those types; skipping them
  is skipping the contract.
- **Default to passthrough — don't mint a DTO that duplicates the type your
  service/query already returns.** That type is usually already consumption-shaped:
  return it (annotation on the handler) and accept the request/command type as
  the body. With a generated, type-checked client, a domain rename that ripples
  to the wire is a compile error in the same build — not a contract you must
  insulate by hand.
- **Introduce a distinct wire DTO only when the wire must diverge from that
  returned type**, for one concrete reason: (1) a field must not reach the wire
  (secrets, internal flags) — a hard security boundary; (2) a deprecated shape
  must be held through a data-migration window; (3) the wire has consumers that
  do not recompile in lockstep (public API, third-party, separately-shipped
  mobile). Absent one of these, the DTO is ceremony. When you do map, keep it
  trivial, never a field-by-field copy that can silently drop a field. In FastAPI
  that knob is `response_model=` (a narrower Pydantic model); the return
  annotation stays the service type.
- **Leak is deny-by-default.** Because passthrough is the default, the moment a
  serialized type gains a field that must not be public, split off a DTO **in
  the same change** — never let a field reach the wire by accretion. A Pydantic
  model (or a `response_model`) is the marker that a type is wire-facing: audit
  its fields on every change. Domain frozen dataclasses are not wire-facing —
  they stay in `hexagonal/python.md`.
- Validate input at the edge (the Pydantic body/path/query types). No
  `if not body.x` after FastAPI has already parsed.
- Errors map to the shared error contract — see `backend/errors.md`
  (problem+json). Register exception handlers on the app (domain errors **and**
  `RequestValidationError`). Do not ship FastAPI's default `{"detail": …}` body;
  do not invent per-handler error shapes.
- Dependencies are resolved from **one composition root** (lifespan builds an
  app container; `Depends` reads ports off it). No module-level engine, no
  `get_db()` that is a hidden service locator. A session is an adapter concern
  (`hexagonal/python.md`).
- Version the API under a path prefix (`/api/v1`).

## Shape

```python
from typing import Annotated, Protocol
from uuid import UUID
from fastapi import APIRouter, Depends, FastAPI
from pydantic import BaseModel

class User(BaseModel):
    id: UUID
    email: str

class UserRepository(Protocol):
    async def by_id(self, id: UUID) -> User: ...

router = APIRouter(prefix="/api/v1")

@router.get("/users/{id}")
async def get_user(
    id: UUID, users: Annotated[UserRepository, Depends(get_users)],
) -> User:
    return await users.by_id(id)
```

`get_users` reads the port from the container created in `lifespan`. The
`Protocol` lives in domain; the FastAPI router is an adapter.

## Checklist

- [ ] Every handler has typed params and a return annotation; OpenAPI lists the operation
- [ ] The type your service returns is serialized directly; no infra/ORM type appears on the wire
- [ ] A DTO / `response_model` exists only where the wire must diverge (hidden field / deprecation window / non-lockstep consumer)
- [ ] Every wire-facing model's fields were re-audited this change — no internal field leaked by accretion
- [ ] Errors go through a central problem+json handler (not FastAPI's `detail` default)
- [ ] `/openapi.json` is served and reachable by the frontend generator
- [ ] Routes are versioned (`/api/v1`)
