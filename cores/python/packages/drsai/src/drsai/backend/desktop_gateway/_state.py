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

import hashlib
import json
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
        from ._remote_worker_backend import RemoteWorkerBackend

        root = state_root()
        _ensure_agent_definition(root)
        backend = DesktopAgentBackend()
        remote_backend = RemoteWorkerBackend()
        _agent_service = RuntimeAgentService(
            runtime_engine(),
            runtime_registry(),
            AgentDefinitionStore(
                root / "assets" / "agents",
                allowed_backends=("opendrsai", "remote-worker"),
            ),
            tool_dispatcher(),
            {backend.backend_id: backend, remote_backend.backend_id: remote_backend},
        )
    return _agent_service


# Agent Definitions are referenced by exact ``id@version``: the store refuses a
# bare id so a Run can never silently bind to a different revision of the asset
# than the one its manifest recorded.
AGENT_DEFINITION_ID = "opendrsai"
AGENT_DEFINITION_VERSION = "1"
DEFAULT_AGENT_DEFINITION = f"{AGENT_DEFINITION_ID}@{AGENT_DEFINITION_VERSION}"

# Remote worker Agent Definition. Individual remote agents (HepAI/DDF workers)
# bind to this backend and carry their worker connection in the payload; the
# Desktop addresses one worker at a time through the same Run contract.
REMOTE_WORKER_DEFINITION_ID = "remote-worker"
REMOTE_WORKER_DEFINITION_VERSION = "1"
DEFAULT_REMOTE_WORKER_DEFINITION = f"{REMOTE_WORKER_DEFINITION_ID}@{REMOTE_WORKER_DEFINITION_VERSION}"


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
    # Seed the remote-worker template too. It carries no credential: a Run that
    # selects it supplies the worker identity, and the backend resolves the
    # url/api-key from the Definition payload (falling back to the platform
    # credential the Runtime already holds).
    remote_path = root / "assets" / "agents" / REMOTE_WORKER_DEFINITION_ID / f"{REMOTE_WORKER_DEFINITION_VERSION}.json"
    if not remote_path.exists():
        remote_path.parent.mkdir(parents=True, exist_ok=True)
        remote_payload = {
            "id": REMOTE_WORKER_DEFINITION_ID,
            "version": REMOTE_WORKER_DEFINITION_VERSION,
            "backend": "remote-worker",
            "instructions": "Proxy a remote HepAI/DDF worker agent through this Runtime.",
            "permissions": [],
            "remote_worker": {},
        }
        remote_temporary = remote_path.with_suffix(".tmp")
        remote_temporary.write_text(
            json.dumps(remote_payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8",
        )
        os.replace(remote_temporary, remote_path)


def agent_definition_store() -> AgentDefinitionStore:
    root = state_root()
    _ensure_agent_definition(root)
    return AgentDefinitionStore(
        root / "assets" / "agents",
        allowed_backends=("opendrsai", "remote-worker"),
    )


def remote_worker_definition_reference(worker_id: str) -> str:
    """Return a deterministic immutable Definition reference for one worker."""
    normalized = str(worker_id or "").strip()
    if not normalized:
        from drsai.backend.runtime.agent import RuntimeExecutionError
        raise RuntimeExecutionError("remote_worker_invalid", "A remote worker id is required.")
    digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:24]
    return f"remote-worker-{digest}@{REMOTE_WORKER_DEFINITION_VERSION}"


def write_remote_worker_definition(payload: dict[str, Any]) -> str:
    """Create/reuse a worker-scoped immutable Definition and return its reference."""
    worker = payload.get("remote_worker")
    name = worker.get("name") if isinstance(worker, dict) else None
    if not isinstance(name, str) or not name.strip():
        from drsai.backend.runtime.agent import RuntimeExecutionError
        raise RuntimeExecutionError("remote_worker_invalid", "A remote worker selection must name a worker.")
    reference = remote_worker_definition_reference(name)
    definition_id, version = reference.rsplit("@", 1)
    scoped_payload = {
        **payload,
        "id": definition_id,
        "version": version,
        "backend": "remote-worker",
        "remote_worker": {**worker, "name": name.strip()},
    }
    path = state_root() / "assets" / "agents" / definition_id / f"{version}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    encoded = json.dumps(scoped_payload, ensure_ascii=False, separators=(",", ":"))
    if path.exists():
        existing = path.read_text(encoding="utf-8")
        if existing != encoded:
            from drsai.backend.runtime.agent import RuntimeExecutionError
            raise RuntimeExecutionError(
                "remote_worker_definition_conflict",
                "The immutable Definition for this remote worker already has different routing data.",
            )
        return reference
    temporary = path.with_suffix(".tmp")
    temporary.write_text(encoded, encoding="utf-8")
    try:
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)
    return reference


def ensure_remote_agents_workspace() -> str:
    """Open the hidden compatibility Workspace used by remote-agent Sessions."""
    root = state_root() / "runtime" / "remote-agents-workspace"
    root.mkdir(parents=True, exist_ok=True)
    record = runtime_registry().open_workspace(str(root), display_name="Remote Agents")
    remember_workspace_root(record.workspace_id, root)
    return record.workspace_id


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
