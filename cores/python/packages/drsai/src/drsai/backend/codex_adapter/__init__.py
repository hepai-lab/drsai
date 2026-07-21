"""Codex Agent Backend adapter boundary.

Only this package may translate OpenDrSai Agent Backend operations to Codex App
Server JSON-RPC. It must not depend on Desktop or Renderer code.
"""

from drsai.backend.codex_adapter.adapter import CodexAdapter, CodexAppServerClient
from drsai.backend.codex_adapter.binary_provider import (
    CodexArtifactStore,
    CodexBinary,
    CodexBinaryProvider,
    CodexPlatformLauncher,
    verify_codex_compatibility,
)
from drsai.backend.codex_adapter.app_server_process import (
    CodexAppServerProcess,
    CodexRestartPolicy,
    redact_secrets,
)
from drsai.backend.codex_adapter.jsonrpc_client import CodexJSONRPCClient
from drsai.backend.codex_adapter.models import CodexModelCapability, CodexModelCatalog
from drsai.backend.codex_adapter.backend_client import CodexAgentBackendClient
from drsai.backend.codex_adapter.event_mapper import CodexEventMapper
from drsai.backend.codex_adapter.security import CodexAccountManager, CodexApprovalBridge
from drsai.backend.codex_adapter.factory import build_codex_adapter

__all__ = [
    "CodexAdapter", "CodexAppServerClient", "CodexArtifactStore", "CodexBinary",
    "CodexBinaryProvider", "CodexPlatformLauncher", "verify_codex_compatibility",
    "CodexAppServerProcess", "CodexRestartPolicy", "redact_secrets",
    "CodexJSONRPCClient",
    "CodexModelCapability", "CodexModelCatalog",
    "CodexAgentBackendClient",
    "CodexEventMapper",
    "CodexAccountManager", "CodexApprovalBridge",
    "build_codex_adapter",
]
