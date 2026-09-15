"""Process-owned singletons for the Desktop gateway.

Everything here is a lazy accessor over ``backend/runtime/``, which is already
implemented.  This gateway owns no persistence of its own: it opens the same
``RuntimeRegistry`` / ``RuntimeEngine`` SQLite files under a state root
resolved from ``DRSAI_HOME`` (falling back to ``~/.drsai``).

None of these accessors are patched by the legacy test suite; this package owns
them outright.  :func:`reset_state` is the single supported way for a test to get a
clean process, and it is why every singleton lives in module scope rather than
in an import-time constructor.
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fastapi import HTTPException

from drsai.backend.runtime.agent import (
    AgentDefinitionStore,
    RuntimeToolDispatcher,
)
from drsai.backend.runtime.artifacts import RuntimeArtifactStore
from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime.registry import RuntimeRegistry

_registry: RuntimeRegistry | None = None
_engine: RuntimeEngine | None = None
_artifact_store: RuntimeArtifactStore | None = None
_tool_dispatcher: RuntimeToolDispatcher | None = None
_agent_service: Any = None
_agent_manager: Any = None
_workspace_roots: dict[str, Path] = {}


def state_root() -> Path:
    """Return the directory holding this Runtime's SQLite state."""
    raw = os.environ.get("DRSAI_HOME") or str(Path.home() / ".drsai")
    return Path(raw).expanduser()


def runtime_registry() -> RuntimeRegistry:
    """Workspace catalog and this Runtime's stable identity."""
    global _registry
    if _registry is None:
        _registry = RuntimeRegistry(state_root() / "runtime" / "runtime.sqlite3")
    return _registry


def runtime_engine() -> RuntimeEngine:
    """Sessions, Runs, the conversation journal, and the OAEP projection."""
    global _engine
    if _engine is None:
        registry = runtime_registry()
        _engine = RuntimeEngine(
            state_root() / "runtime" / "engine.sqlite3",
            RuntimeEngineIdentity(registry.identity.runtime_id, registry.identity.instance_id),
            lambda workspace_id: bool(
                (record := registry.get_workspace(workspace_id, include_closed=True)) and record.open
            ),
            lambda workspace_id: (
                record.worktree_id
                if (record := registry.get_worktree_by_workspace(workspace_id))
                else None
            ),
        )
    return _engine


def workspace_root(workspace_id: str) -> Path:
    """Resolve an open Workspace to its on-disk root, or 404."""
    root = _workspace_roots.get(workspace_id)
    if root is None:
        record = runtime_registry().get_workspace(workspace_id)
        if record and Path(record.path).is_dir():
            root = Path(record.path)
            _workspace_roots[workspace_id] = root
    if root is None:
        raise HTTPException(status_code=404, detail="Workspace is not open")
    return root


def remember_workspace_root(workspace_id: str, root: Path) -> None:
    _workspace_roots[workspace_id] = root


def artifact_store() -> RuntimeArtifactStore:
    """Durable, Workspace-scoped Artifact records behind ``deliver_artifact``."""
    global _artifact_store
    if _artifact_store is None:
        _artifact_store = RuntimeArtifactStore(
            state_root() / "runtime" / "artifacts.sqlite3",
            lambda workspace_id: workspace_root(workspace_id),
        )
    return _artifact_store


def tool_dispatcher() -> RuntimeToolDispatcher:
    """Runtime-hosted tools an Agent may invoke through the Runtime, not the model."""
    global _tool_dispatcher
    if _tool_dispatcher is None:
        from ._artifacts import deliver_runtime_artifact, publish_runtime_artifact

        _tool_dispatcher = RuntimeToolDispatcher(
            runtime_engine(),
            tools={
                "artifact.publish": publish_runtime_artifact,
                "artifact.deliver": deliver_runtime_artifact,
            },
        )
    return _tool_dispatcher


def agent_manager():
    """The per-(user, session) OpenDrSai Agent cache."""
    global _agent_manager
    if _agent_manager is None:
        from ._agent_manager import DesktopAgentManager

        _agent_manager = DesktopAgentManager()
    return _agent_manager


def agent_service():
    """The Runtime service that owns Run lifecycle and dispatches to a backend."""
    global _agent_service
    if _agent_service is None:
        from drsai.backend.runtime.agent import RuntimeAgentService

        from ._agent_backend import DesktopAgentBackend

        root = state_root()
        _ensure_agent_definition(root)
        backend = DesktopAgentBackend()
        _agent_service = RuntimeAgentService(
            runtime_engine(),
            runtime_registry(),
            AgentDefinitionStore(root / "assets" / "agents", allowed_backends=("opendrsai",)),
            tool_dispatcher(),
            {backend.backend_id: backend},
        )
    return _agent_service


# Agent Definitions are referenced by exact ``id@version``: the store refuses a
# bare id so a Run can never silently bind to a different revision of the asset
# than the one its manifest recorded.
AGENT_DEFINITION_ID = "opendrsai"
AGENT_DEFINITION_VERSION = "1"
DEFAULT_AGENT_DEFINITION = f"{AGENT_DEFINITION_ID}@{AGENT_DEFINITION_VERSION}"


def _ensure_agent_definition(root: Path) -> None:
    """Seed the single built-in Agent Definition this surface needs.

    There is no Agent Definition CRUD surface: the desktop always runs the one
    production OpenDrSai Agent, and the model comes from the Run's request, not
    from the definition asset.  Seeding here rather than at service startup
    keeps a freshly installed Runtime able to serve its very first run.
    """
    import json

    path = root / "assets" / "agents" / AGENT_DEFINITION_ID / f"{AGENT_DEFINITION_VERSION}.json"
    if path.exists():
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "id": AGENT_DEFINITION_ID,
        "version": AGENT_DEFINITION_VERSION,
        "backend": "opendrsai",
        "instructions": "Use the production OpenDrSai Agent in this Runtime Workspace.",
        "permissions": [],
    }
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    os.replace(temporary, path)


def agent_definition_store() -> AgentDefinitionStore:
    root = state_root()
    _ensure_agent_definition(root)
    return AgentDefinitionStore(root / "assets" / "agents", allowed_backends=("opendrsai",))


def reset_state() -> None:
    """Drop every singleton. Tests call this between state roots."""
    global _registry, _engine, _artifact_store, _tool_dispatcher, _agent_service, _agent_manager
    _registry = None
    _engine = None
    _artifact_store = None
    _tool_dispatcher = None
    _agent_service = None
    _agent_manager = None
    _workspace_roots.clear()
