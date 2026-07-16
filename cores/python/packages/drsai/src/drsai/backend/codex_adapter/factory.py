"""Composition root for the Runtime-owned Codex Agent Backend."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Mapping

from drsai.backend.agent_backend_bindings import AgentBackendBindingStore
from drsai.backend.codex_adapter.adapter import CodexAdapter
from drsai.backend.codex_adapter.app_server_process import CodexAppServerProcess
from drsai.backend.codex_adapter.backend_client import CodexAgentBackendClient
from drsai.backend.codex_adapter.binary_provider import CodexArtifactStore, CodexBinaryProvider, load_trusted_publishers
from drsai.backend.codex_adapter.jsonrpc_client import CodexJSONRPCClient
from drsai.backend.codex_adapter.security import CodexApprovalBridge


def build_codex_adapter(state_root: Path, runtime_state: Any, *, environ: Mapping[str, str] | None = None) -> CodexAdapter:
    """Build one co-located Codex Backend without starting its process eagerly."""
    environment = dict(os.environ if environ is None else environ)
    codex_root = Path(state_root) / "runtime" / "codex"
    store = CodexArtifactStore(codex_root / "artifacts", _trusted_publishers(codex_root))
    development = environment.get("DRSAI_CODEX_DEVELOPMENT") == "1"
    provider = CodexBinaryProvider(store, mode="development" if development else "product", environ=environment)
    supervisor = CodexAppServerProcess(provider, verify_binary=not development)
    rpc = CodexJSONRPCClient(supervisor)
    bindings = AgentBackendBindingStore(codex_root / "bindings.sqlite3")
    bridge = CodexApprovalBridge(rpc, runtime_state, bindings)
    client = CodexAgentBackendClient(
        rpc, bindings, runtime_state=runtime_state, approval_bridge=bridge,
    )
    bridge.recover_orphaned_pending()
    return CodexAdapter(client)


def _trusted_publishers(codex_root: Path) -> dict[str, bytes]:
    path = codex_root / "trusted-publishers.json"
    return {} if not path.exists() else load_trusted_publishers(path)
