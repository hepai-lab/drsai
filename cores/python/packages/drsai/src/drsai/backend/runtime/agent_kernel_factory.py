"""Only construction boundary for the shared ``drsai-agent-kernel`` loop."""

from __future__ import annotations

from typing import Any

try:  # Regular Desktop/TUI package import.
    from .agent_kernel import agent_kernel_identity
    from .mobile_core.engine import DrSaiAgentKernel
except ImportError:  # Android Chaquopy copies the Runtime root as top-level modules.
    from agent_kernel import agent_kernel_identity
    from mobile_core.engine import DrSaiAgentKernel


SUPPORTED_AGENT_KERNEL_SURFACES = frozenset({"android", "desktop", "tui", "test"})


def create_agent_kernel(*, surface: str) -> DrSaiAgentKernel:
    """Construct the sole Agent Loop type and bind its immutable shared identity."""

    normalized = surface.strip().lower() if isinstance(surface, str) else ""
    if normalized not in SUPPORTED_AGENT_KERNEL_SURFACES:
        raise ValueError("agent_kernel_surface_invalid")
    identity_surface = "android" if normalized == "android" else "desktop"
    kernel = DrSaiAgentKernel()
    identity = agent_kernel_identity(surface=identity_surface)
    if kernel.agent_type != identity["kernel_id"]:
        raise RuntimeError("agent_kernel_type_identity_drift")
    # Surface is diagnostic adapter state only. It never enters Run decisions.
    kernel._factory_surface = normalized
    kernel._factory_runtime_surface = identity_surface
    kernel._factory_identity = identity
    return kernel


def kernel_factory_identity(kernel: Any) -> dict[str, Any]:
    if not isinstance(kernel, DrSaiAgentKernel):
        raise TypeError("agent_kernel_instance_invalid")
    identity = getattr(kernel, "_factory_identity", None)
    if not isinstance(identity, dict):
        raise RuntimeError("agent_kernel_factory_identity_missing")
    return dict(identity)
