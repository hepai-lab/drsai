"""The FastAPI application: config + runtime + audio + models + runs + sessions + workspaces.

This is a **separate app** from ``gateway_legacy``'s, deliberately. Mounting
these routers onto the legacy ``app`` would inherit its middleware stack and
break the three frozen route-order/OpenAPI snapshots that hold the legacy
surface still while it is retired. The two apps share the Runtime beneath them,
not the HTTP layer above it.

The ``config`` router provides V1-compatible ``/v1/config/*`` routes that the
Electron renderer calls during startup and for settings management.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI

from . import _auth, _state
from drsai.backend.gfs_api import register_gfs_routes
from drsai.backend.skills_api import register_skills_routes

from .routes import (
    agent_backends,
    audio,
    capabilities,
    config,
    identity,
    models,
    runs,
    runtime,
    sessions,
    workspaces,
)

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
    config.router,
    capabilities.router,
    agent_backends.router,
    identity.router,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Seed the default provider, model selection and Agent Model Policy that
    # the config surface (routes/config.py) reads.  V1 gateway_legacy does this
    # when OPENDRSAI_DESKTOP_RUNTIME == "1"; this gateway IS the desktop runtime,
    # so we always bootstrap.
    import asyncio
    import logging

    from drsai.config import ensure_desktop_runtime_config

    logger = logging.getLogger("drsai.desktop_gateway")
    try:
        bootstrap = await asyncio.to_thread(ensure_desktop_runtime_config)
        logger.info(
            "Desktop Runtime configuration ready (changed={}, actions={})",
            bootstrap.changed,
            ",".join(bootstrap.actions) or "none",
        )
    except Exception as exc:
        logger.exception(
            "Desktop Runtime configuration bootstrap failed: {}", type(exc).__name__,
        )

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
    register_gfs_routes(app)
    register_skills_routes(app)
    return app


app = create_app()


def main() -> None:
    """Run the Desktop Runtime gateway under uvicorn."""
    import uvicorn

    uvicorn.run(app, host=DEFAULT_HOST, port=DEFAULT_PORT)


if __name__ == "__main__":
    main()
