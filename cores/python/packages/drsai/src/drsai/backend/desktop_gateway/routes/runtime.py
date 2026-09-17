"""Runtime identity -- the only unauthenticated route (feature 1).

The desktop calls this before it has anything else: to confirm the process it
launched is the Runtime it expects, and to learn the protocol version so a
mismatched pair fails with a clear message instead of odd 422s later.

``runtime_source_digest`` is captured at import time, deliberately. A dev
Runtime still running yesterday's code therefore reports yesterday's digest and
cannot claim the fingerprint of newer files sitting on disk.
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import signal
import sys
from pathlib import Path

from fastapi import APIRouter

from drsai.backend.remote_ssh.workspace import PROTOCOL_VERSION

from .. import _state

api = APIRouter(tags=["runtime"])

# One name per feature that has a gateway route behind it. Features 2.4 (个人信息)
# and 3.3 (会话状态) are absent because they need no route: the first reads OIDC
# claims the main process already holds, the second folds run.status off the
# event stream.
CAPABILITIES = frozenset({
    "workspaces",
    "sessions",
    "session_events",
    "runs",
    "model_catalog",
    "speech_to_text",
    "workspace_files",
})


def _source_digest() -> str:
    """Fingerprint the gateway implementation actually loaded by this process."""
    package = Path(__file__).resolve().parent.parent
    factory = package.parent / "run_drsai_agent_factory.py"
    files = sorted(package.rglob("*.py")) + ([factory] if factory.exists() else [])
    digest = hashlib.sha256()
    for path in files:
        digest.update(path.relative_to(package.parent).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


SOURCE_DIGEST = _source_digest()


@api.get("/health", operation_id="healthCheck")
async def health_check():
    """Health probe for the Electron main process.

    The desktop's ``gateway.ts`` polls this before any other route to confirm
    the spawned Python process is alive.  It returns the simplest possible
    body so the polling loop can short-circuit on ``status === "ok"``
    without parsing the full Runtime identity.
    """
    return {"status": "ok"}


@api.get("/v1/runtime", operation_id="getRuntimeIdentity")
async def runtime_identity():
    """Identify this Runtime instance and the contract it speaks."""
    registry = _state.runtime_registry()
    try:
        from drsai.version import __version__ as runtime_version
    except Exception:
        runtime_version = "unknown"
    return {
        "runtime_id": registry.identity.runtime_id,
        "instance_id": registry.identity.instance_id,
        "version": runtime_version,
        "protocol_version": PROTOCOL_VERSION,
        "surface": "desktop-v2",
        # What this surface implements, so the renderer can hide controls it has
        # no route for rather than discovering a 404 at click time. Whether the
        # *user* can currently use one (STT needs an identity) is a separate,
        # per-request question the renderer already knows the answer to.
        "capabilities": sorted(CAPABILITIES),
        "platform": sys.platform,
        "dev_managed": os.environ.get("DRSAI_GATEWAY_DEV_MANAGED") == "1",
        "runtime_source_digest": SOURCE_DIGEST,
    }


@api.post("/v1/runtime/shutdown", operation_id="shutdownRuntime")
async def runtime_shutdown():
    """Stop this Runtime instance after the response is flushed.

    Migrated from ``gateway_legacy.py`` L4674.  The 0.2 s delay lets the HTTP
    response reach the caller before the process exits.
    """
    loop = asyncio.get_running_loop()
    loop.call_later(0.2, lambda: os.kill(os.getpid(), signal.SIGTERM))
    return {
        "stopping": True,
        "instance_id": _state.runtime_registry().identity.instance_id,
    }


def router() -> APIRouter:
    return api
