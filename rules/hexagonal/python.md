---
paths:
  - "**/*.py"
title: "Hexagonal Architecture — Python"
---

## Import graph

```
src/<pkg>/
  domain/      → frozen dataclasses, Protocol ports, domain exceptions
  adapters/    → FastAPI routers, SQLAlchemy, httpx, …
  main.py      → composition root (lifespan, container, app.include_router)
```

Names can vary (`core` / `infra`); the arrows cannot.

```
main → adapters → domain
                      ↑
              NEVER depends on
              anything above
```

`just python-check` sees `mypy --strict` and ruff. It does not see an adapter
import inside `domain/`.

## Domain — pure

- Frozen dataclasses (or equivalent value types). **Pydantic `BaseModel` is an
  edge type** — parse once in the adapter, then work with domain types
  (`python/code-style.md`).
- Ports are `typing.Protocol` (structural, no ABC tax). Typed domain errors on
  those signatures — not `Exception`, not `None` meaning "infra failed".
- **Forbidden imports in domain:** `fastapi`, `starlette`, `uvicorn`,
  `sqlalchemy`, `httpx`, `redis`, `celery`, `boto3`, and any other driver or
  framework. `uuid` / `datetime` / stdlib are fine.

## Adapters — implement the ports

```python
class SqlUserRepository:
    def __init__(self, session: AsyncSession) -> None: ...
    async def by_id(self, id: UUID) -> User:
        row = await self._session.get(UserRow, id)
        return User(id=row.id, email=row.email)
```

The ORM row type never appears in `domain/`. Translate at the adapter;
chain the cause (`python/error-handling.md`).

## Composition root

`lifespan` (or `main.py`) constructs the container and mounts routers.
`Depends` reads ports off that container. No module-level
`engine = create_async_engine(...)`, and **a handler never opens a connection
itself** — it receives a port that already has one.
