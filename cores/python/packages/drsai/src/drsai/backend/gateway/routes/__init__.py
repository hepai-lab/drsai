"""Gateway route modules.

Each module exposes a ``router()`` factory returning an ``APIRouter``;
``gateway._app.mount_routers`` includes them onto the FastAPI ``app``. The
per-module import below mirrors the ``tui_gateway/handlers`` convention.
"""

from __future__ import annotations

from . import logs  # noqa: F401  (Phase 1: logs routes)
from . import platforms  # noqa: F401  (Phase 1: platform-toggle routes)
from . import env  # noqa: F401  (Phase 1: env-file routes)
from . import cli_config  # noqa: F401  (Phase 1: cli-config routes)
from . import hepai_workers  # noqa: F401  (Phase 1: hepai-worker routes)
from . import threads  # noqa: F401  (Phase 1: threads/session routes)
