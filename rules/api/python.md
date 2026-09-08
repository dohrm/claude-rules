---
paths:
  - "**/*.py"
title: "HTTP API — Python (FastAPI + Pydantic)"
---

**FastAPI** for routing + **Pydantic v2** for the types that generate the OpenAPI
spec. Passthrough, the DTO reasons, leak, problem+json and versioning:
`api/principle.md`.

`just python-check` owns ruff / mypy / pytest. It does not see a route without a
return annotation, nor a leaked field on a Pydantic model, nor problem+json
(FastAPI's default error body is `{"detail": …}`).

## Stack

- **FastAPI** — router, `Depends`, lifespan, OpenAPI 3 from the type hints.
- **Pydantic v2** — wire types. Parse once at the edge; the annotation *is* the schema.
- **uvicorn** — the ASGI server (composition root runs it).
- Serve the spec at `/openapi.json` — the frontend generator reads it — and, in non-prod, the built-in Swagger UI (`docs` path).

This is the **backend** Python profile — distinct from a worker or a script.
Add `python-api` (or `api` + `backend` + `hexagonal`) for an HTTP service.

## Rules

- Every route is a FastAPI/`APIRouter` handler with typed parameters **and** a
  return annotation. A raw Starlette `Route`, a `dict` return, or `-> None` on a
  200 that has a body is a bug: OpenAPI and validation both come from those types.
- **A Pydantic model — or a `response_model` — is the marker that a type is
  wire-facing**, and that is what to audit on every change (`api/principle.md` —
  leak is deny-by-default). `response_model=` is the knob when the wire must
  narrow; the return annotation stays the service type. Domain frozen dataclasses
  are not wire-facing — they stay in `hexagonal/python.md`.
- Input is validated by the Pydantic body/path/query types. No `if not body.x`
  after FastAPI has already parsed.
- Exception handlers are registered on the app for domain errors **and**
  `RequestValidationError`, rendering problem+json (`backend/errors.md`). Never
  ship FastAPI's default `{"detail": …}` body.
- Dependencies are resolved from **one composition root** (lifespan builds an app
  container; `Depends` reads ports off it). No module-level engine, no `get_db()`
  that is a hidden service locator. A session is an adapter concern
  (`hexagonal/python.md`).

## Shape

```python
from typing import Annotated, Protocol
from uuid import UUID
from fastapi import APIRouter, Depends
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
