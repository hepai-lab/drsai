"""The single construction boundary for the shared mobile Agent Core."""

from __future__ import annotations

from .engine import MobileAgentCore


SUPPORTED_SURFACES = {"android", "desktop", "tui", "test"}


def create_shared_mobile_core(*, surface: str) -> MobileAgentCore:
    if surface not in SUPPORTED_SURFACES:
        raise ValueError("mobile_core_surface_invalid")
    # Surface is deliberately not stored in Core state: decisions and emitted
    # events must remain identical across adapters.
    return MobileAgentCore()
