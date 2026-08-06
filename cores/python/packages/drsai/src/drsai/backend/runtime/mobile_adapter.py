"""Desktop and TUI adapters for the shared mobile Runtime V2 Core."""

from __future__ import annotations

from typing import Iterable

from .agent_kernel_factory import create_agent_kernel, kernel_factory_identity
from .mobile_core import RuntimeEnvelope


class SharedMobileCoreAdapter:
    def __init__(self, surface: str) -> None:
        self.surface = surface
        self._core = create_agent_kernel(surface=surface)

    @property
    def agent_type(self) -> str:
        return self._core.agent_type

    @property
    def kernel_identity(self) -> dict:
        return kernel_factory_identity(self._core)

    def reset(self) -> None:
        self._core = create_agent_kernel(surface=self.surface)

    def execute(self, envelope: RuntimeEnvelope) -> tuple[RuntimeEnvelope, ...]:
        return self._core.handle(envelope)

    def execute_many(self, envelopes: Iterable[RuntimeEnvelope]) -> tuple[RuntimeEnvelope, ...]:
        return tuple(item for envelope in envelopes for item in self.execute(envelope))


class DesktopMobileCoreAdapter(SharedMobileCoreAdapter):
    def __init__(self) -> None:
        super().__init__("desktop")


class TuiMobileCoreAdapter(SharedMobileCoreAdapter):
    def __init__(self) -> None:
        super().__init__("tui")


def create_surface_mobile_core(surface: str) -> SharedMobileCoreAdapter:
    """Production entry point shared by the TUI and Desktop runtime hosts."""
    normalized = surface.strip().lower()
    if normalized == "desktop":
        return DesktopMobileCoreAdapter()
    if normalized == "tui":
        return TuiMobileCoreAdapter()
    raise ValueError("mobile_core_surface_invalid")
