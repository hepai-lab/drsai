"""The Desktop Runtime gateway -- 17 routes for the 11 desktop features.

Written against ``apps/desktop/docs/v2/v2-minimal-surface.zh-CN.md``. "V2" in
the comments here names the **contract generation** (the wire contract lives in
``cores/protocol/desktop-v2/``), not this package; the package is named for what
it serves, because it is meant to outlive the migration that produced it.

Why this is a sibling of ``backend/gateway`` rather than a subpackage of it:
``gateway/__init__.py`` ``exec``s the 13,000-line ``gateway_legacy.py`` into its
own namespace at import time, so importing ``gateway.desktop`` would boot the
entire legacy monolith before a single route here was reachable -- and would
keep these tests hostage to legacy import errors. Nothing in this package
imports ``gateway`` or ``gateway_legacy``, so retiring the legacy monolith is a
deletion, not a disentangling.

State and ports are addressable via environment variables::

    DRSAI_HOME                   state root   (falls back to ~/.drsai)
    DRSAI_DESKTOP_GATEWAY_HOST   bind host    (default 127.0.0.1)
    DRSAI_DESKTOP_GATEWAY_PORT   bind port    (default 28643)

The pairing token is read from ``DRSAI_HOME`` because it is a Desktop handoff
file rather than Runtime state.

Layout::

    app.py             FastAPI assembly + uvicorn entry point
    _auth.py           the one middleware (gateway token + OIDC bearer)
    _state.py          lazy Runtime singletons
    _models.py         request bodies
    _errors.py         Runtime exception -> HTTP mapping
    _oaep.py           P1 -> P2 Item projection
    _artifacts.py      deliver_artifact and the artifacts/ sweep
    _agent_manager.py  per-(user, session) Agent cache
    _agent_backend.py  autogen events -> Runtime events (the migrated class)
    _workspace_files.py  file tree + single-file read
    routes/            runtime, workspaces, sessions, runs, models, audio
"""

from __future__ import annotations

from .app import DEFAULT_HOST, DEFAULT_PORT, create_app, main

__all__ = ["create_app", "main", "DEFAULT_HOST", "DEFAULT_PORT"]
