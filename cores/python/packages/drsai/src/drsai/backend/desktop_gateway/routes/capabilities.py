"""Runtime capabilities -- ``GET /v1/capabilities``.

The desktop's ``LocalRuntimeClient.connect()`` calls this immediately after the
handshake to learn what this gateway can do.  The response mirrors the V1
``gateway_legacy.py`` shape so the renderer's feature-detection logic works
unchanged:

- ``protocol_version``  -- wire-protocol version (same as ``/v1/runtime``)
- ``protocols``          -- per-protocol metadata (oaep, owop, control, relay)
- ``capabilities``      -- sorted list of feature names
- ``capability_versions``-- ``{feature: version}`` dict
- ``agent_backends``    -- ``{backend_id: health_info}`` from the agent service

``run_experiments`` is omitted in V2 because the desktop gateway does not host
the experiment-override subsystem; the frontend tolerates its absence.
"""

from __future__ import annotations

from fastapi import APIRouter

from drsai.backend.remote_ssh.workspace import PROTOCOL_VERSION
from drsai.oaep.generated import OAEP_PROFILE, OAEP_SCHEMA_SHA256, OAEP_VERSION

from .. import _state
from .runtime import CAPABILITIES

api = APIRouter(tags=["capabilities"])

# Feature → version.  Mirrors the V1 ``_REMOTE_CAPABILITY_VERSIONS`` dict but
# trimmed to what the V2 desktop gateway actually implements.  The frontend
# uses these keys for feature-gating; returning only the V2-backed features
# means the renderer hides controls that would 404 at click time.
_CAPABILITY_VERSIONS: dict[str, int] = {
    "workspaces": 1,
    "sessions": 1,
    "session_events": 1,
    "runs": 1,
    "model_catalog": 1,
    "speech_to_text": 1,
    "workspace_files": 1,
    "agent-backend": 1,
    "agent-backend-account": 1,
    # ── OAEP protocol capabilities ──────────────────────────────────────
    # The frontend's ``selectRuntimeConversationProtocolResult()`` requires
    # all five of these to be present in ``capabilities`` before it will
    # select the OAEP path.  Without them the chat flow aborts with
    # ``oaep_runtime_required`` and the user sees "回复失败".
    "oaep.v1": 1,
    "oaep.session.snapshot": 1,
    "oaep.session.events": 1,
    "oaep.session.events.stream": 1,
    "event.cursor_expired": 1,
}

# Per-protocol metadata.  V2 advertises ``oaep`` and ``control``.  The
# desktop gateway does not advertise ``relay`` or ``owop`` because those
# subsystems are not wired in V2.
_RUNTIME_PROTOCOLS: dict[str, dict] = {
    "control": {"version": "1"},
    # OAEP protocol metadata.  The frontend matches ``version``,
    # ``profiles``, and ``schema_sha256`` against constants generated
    # from ``cores/protocol/oaep/oaep.schema.json``.  Any mismatch here
    # causes ``selectRuntimeConversationProtocolResult()`` to return
    # ``unavailable`` and the chat aborts.
    "oaep": {
        "version": OAEP_VERSION,
        "profiles": [OAEP_PROFILE],
        "schema_sha256": OAEP_SCHEMA_SHA256,
    },
}


@api.get("/v1/capabilities", operation_id="getCapabilities")
async def get_capabilities():
    """Publish the gateway's protocol version, feature set, and agent backends."""
    agent_backends: dict = {}
    try:
        service = _state.agent_service()
        agent_backends = dict(await service.health())
    except Exception:
        # If the agent service is not yet initialised (e.g. during a cold
        # start before the first workspace is opened), return an empty
        # dict rather than 500-ing the whole capabilities call.
        agent_backends = {}

    return {
        "protocol_version": PROTOCOL_VERSION,
        "protocols": _RUNTIME_PROTOCOLS,
        "capabilities": sorted(_CAPABILITY_VERSIONS),
        "capability_versions": _CAPABILITY_VERSIONS,
        "agent_backends": agent_backends,
    }


def router() -> APIRouter:
    return api
