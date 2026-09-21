"""The route modules, one per feature group.

Each exposes ``router() -> APIRouter``; ``desktop_gateway.app.create_app`` mounts
them in the order below.
"""

from __future__ import annotations

from . import agent_backends  # noqa: F401  (agent-backend account & models)
from . import audio  # noqa: F401  (3.4 speech to text)
from . import capabilities  # noqa: F401  (GET /v1/capabilities)
from . import channels_wechat  # noqa: F401  (/v1/channels/wechat/* account pairing + channel lifecycle)
from . import config  # noqa: F401  (V1-compatible /v1/config/* routes)
from . import config_agents  # noqa: F401  (V1-compatible agent runtime-policy routes: tools/skills/knowledge + realtime-voice-probe)
from . import config_providers  # noqa: F401  (V1-compatible model-provider config write/test/probe routes)
from . import config_tools  # noqa: F401  (V1-compatible tool management routes: list/create/update/delete/test/capabilities)
from . import config_knowledge  # noqa: F401  (V1-compatible knowledge-base management routes: list/create/update/delete/status/test/index/search-preview)
from . import identity  # noqa: F401  (user-name & identity/canonicalize)
from . import gfs  # noqa: F401  (/v1/gfs/* cloud storage)
from . import models  # noqa: F401  (3.2 model selection + /v1/models)
from . import runs  # noqa: F401  (3.1 chat write path)
from . import remote_workers  # noqa: F401  (remote worker catalog & dispatch)
from . import runtime  # noqa: F401  (1 handshake)
from . import sessions  # noqa: F401  (2.1 2.2 3.1 3.3)
from . import skills  # noqa: F401  (/v1/skills* local installed-skills CRUD)
from . import skills_square  # noqa: F401  (/v1/skills-square/* WebUI marketplace proxy)
from . import workspaces  # noqa: F401  (2.3 2.5 4.1)

__all__ = [
    "runtime", "workspaces", "sessions", "runs", "models", "audio", "config",
    "config_agents", "config_providers", "config_tools", "config_knowledge", "capabilities", "agent_backends",
    "remote_workers", "channels_wechat",
    "identity", "gfs", "skills", "skills_square",
]
