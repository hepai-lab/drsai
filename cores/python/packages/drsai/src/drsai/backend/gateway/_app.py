"""FastAPI app wiring for the modular gateway.

Phase 1+: the ``app`` (constructed by the legacy monolith re-executed into the
``gateway`` package namespace) gets the newly-extracted route routers mounted
here via :func:`mount_routers`. Each migration phase removes routes from
``gateway_legacy.py`` and adds an ``app.include_router(...)`` call below.
"""

from __future__ import annotations

from fastapi import FastAPI

from .routes import logs as _logs_routes  # noqa: F401  (Phase 1: logs)
from .routes import platforms as _platforms_routes  # noqa: F401  (Phase 1: platforms)
from .routes import env as _env_routes  # noqa: F401  (Phase 1: env)
from .routes import cli_config as _cli_config_routes  # noqa: F401  (Phase 1: cli-config)
from .routes import hepai_workers as _hepai_workers_routes  # noqa: F401  (Phase 1: hepai-workers)
from .routes import threads as _threads_routes  # noqa: F401  (Phase 1: threads)


def mount_routers(app: FastAPI) -> None:
    """Mount routers extracted from the legacy monolith onto ``app``."""
    app.include_router(_logs_routes.router())
    app.include_router(_platforms_routes.router())
    app.include_router(_env_routes.router())
    app.include_router(_cli_config_routes.router())
    app.include_router(_hepai_workers_routes.router())
    app.include_router(_threads_routes.router())
