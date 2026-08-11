"""Backend-neutral normalized history capability contracts."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Protocol, Sequence


@dataclass(frozen=True)
class HistoryCapability:
    mapping_version: str
    page_size: int = 100
    maximum_page_size: int = 500
    native_pagination: bool = False
    recent_first: bool = True

    def as_dict(self) -> dict[str, Any]:
        return {
            "mapping_version": self.mapping_version,
            "page_size": self.page_size,
            "maximum_page_size": self.maximum_page_size,
            "native_pagination": self.native_pagination,
            "recent_first": self.recent_first,
        }


class BackendHistoryProvider(Protocol):
    def history_capability(self) -> Mapping[str, Any]: ...

    async def read_normalized_history(
        self, session_id: str, *, cursor: str | None = None, limit: int = 100,
    ) -> Mapping[str, Any]: ...

    def plan_history_migration(
        self, session_id: str, history: Sequence[Mapping[str, Any]],
        existing_items: Sequence[Mapping[str, Any]], existing_events: Sequence[Mapping[str, Any]],
        *, mapping_version: str, reasons: Sequence[str],
    ) -> Mapping[str, Any]: ...


def validate_history_page(page: Mapping[str, Any], capability: Mapping[str, Any]) -> dict[str, Any]:
    turns = page.get("turns")
    if not isinstance(turns, list) or any(not isinstance(turn, Mapping) for turn in turns):
        raise ValueError("Backend history page has invalid Turns")
    mapping_version = str(page.get("mapping_version") or "")
    if not mapping_version or mapping_version != str(capability.get("mapping_version") or ""):
        raise ValueError("Backend history mapping version changed during paging")
    return {
        **dict(page),
        "turns": [dict(turn) for turn in turns],
        "next_cursor": str(page["next_cursor"]) if page.get("next_cursor") else None,
        "estimated_total": max(len(turns), int(page.get("estimated_total") or len(turns))),
        "truncated": bool(page.get("truncated") or page.get("next_cursor")),
    }
