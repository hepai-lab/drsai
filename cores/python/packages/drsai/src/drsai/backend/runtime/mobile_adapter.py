"""Desktop and TUI adapters for the shared mobile Runtime V2 Core."""

from __future__ import annotations

from typing import Iterable

from .mobile_core import RuntimeEnvelope, create_shared_mobile_core


class SharedMobileCoreAdapter:
    def __init__(self, surface: str) -> None:
        self.surface = surface
        self._core = create_shared_mobile_core(surface=surface)

    def reset(self) -> None:
        self._core = create_shared_mobile_core(surface=self.surface)

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
