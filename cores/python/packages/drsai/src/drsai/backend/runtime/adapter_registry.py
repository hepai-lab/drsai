"""Registry for replaceable Backend-private event adapters."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from drsai.backend.runtime.normalized_events import (
    AgentEventAdapter,
    NormalizedAgentEvent,
)


class AgentEventAdapterRegistry:
    def __init__(self, adapters: list[AgentEventAdapter] | None = None) -> None:
        self._adapters: dict[str, AgentEventAdapter] = {}
        for adapter in adapters or []:
            self.register(adapter)

    def register(self, adapter: AgentEventAdapter) -> None:
        backend_id = str(getattr(adapter, "backend_id", "")).strip()
        if not backend_id:
            raise ValueError("Agent Event Adapter backend_id is required")
        if backend_id in self._adapters:
            raise ValueError(f"Agent Event Adapter {backend_id} is already registered")
        self._adapters[backend_id] = adapter

    def decode(
        self, backend_id: str, message: Mapping[str, Any]
    ) -> NormalizedAgentEvent | None:
        try:
            adapter = self._adapters[backend_id]
        except KeyError as exc:
            raise KeyError(f"Agent Event Adapter {backend_id} is not registered") from exc
        event = adapter.decode(message)
        if event is not None and event.backend != backend_id:
            raise ValueError("Agent Event Adapter emitted a foreign backend identity")
        return event

    @property
    def backend_ids(self) -> frozenset[str]:
        return frozenset(self._adapters)
