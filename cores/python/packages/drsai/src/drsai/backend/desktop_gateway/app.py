"""The FastAPI application: 17 routes, one middleware.

This is a **separate app** from ``gateway_legacy``'s, deliberately. Mounting
these routers onto the legacy ``app`` would inherit its middleware stack and
break the three frozen route-order/OpenAPI snapshots that hold the legacy
surface still while it is retired. The two apps share the Runtime beneath them,
not the HTTP layer above it.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import _auth, _state
from .routes import audio, models, runs, runtime, sessions, workspaces

DEFAULT_HOST = os.environ.get("DRSAI_DESKTOP_GATEWAY_HOST", "127.0.0.1")
# 28642 belongs to the frozen gateway in the desktop dev setup; this takes the
# next port so both can run at once during the migration.
DEFAULT_PORT = int(os.environ.get("DRSAI_DESKTOP_GATEWAY_PORT", "28643"))

ROUTERS = (
    runtime.router,
    workspaces.router,
    sessions.router,
    runs.router,
    models.router,
    audio.router,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    yield
    service = _state.agent_service()
    for backend in service.backends.values():
        await backend.close()
    await _state.agent_manager().close()


def create_app() -> FastAPI:
    """Build the Desktop Runtime app."""
    app = FastAPI(
        title="OpenDrSai Desktop Runtime",
        version="2.0.0",
        lifespan=lifespan,
    )
    _auth.install(app)
    for factory in ROUTERS:
        app.include_router(factory())
    return app


app = create_app()


def main() -> None:
    """Run the Desktop Runtime gateway under uvicorn."""
    import uvicorn

    uvicorn.run(app, host=DEFAULT_HOST, port=DEFAULT_PORT)


if __name__ == "__main__":
    main()
