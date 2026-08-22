"""Compatibility import for the former mobile-only construction name."""

from __future__ import annotations

from .engine import DrSaiAgentKernel


def create_shared_mobile_core(*, surface: str) -> DrSaiAgentKernel:
    from ..agent_kernel_factory import create_agent_kernel

    return create_agent_kernel(surface=surface)
