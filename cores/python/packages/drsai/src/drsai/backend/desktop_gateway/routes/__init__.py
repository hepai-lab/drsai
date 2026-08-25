"""The six route modules, one per feature group.

Each exposes ``router() -> APIRouter``; ``desktop_gateway.app.create_app`` mounts
them in the order below.
"""

from __future__ import annotations

from . import audio  # noqa: F401  (3.4 speech to text)
from . import models  # noqa: F401  (3.2 model selection)
from . import runs  # noqa: F401  (3.1 chat write path)
from . import runtime  # noqa: F401  (1 handshake)
from . import sessions  # noqa: F401  (2.1 2.2 3.1 3.3)
from . import workspaces  # noqa: F401  (2.3 2.5 4.1)

__all__ = ["runtime", "workspaces", "sessions", "runs", "models", "audio"]
