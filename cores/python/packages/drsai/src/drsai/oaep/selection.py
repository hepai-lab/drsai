"""Canonical OAEP/legacy capability negotiation result."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Mapping, Sequence

from .generated import OAEP_PROFILE, OAEP_SCHEMA_SHA256, OAEP_VERSION


OAEP_REQUIRED = frozenset({
    "oaep.v1", "oaep.session.snapshot", "oaep.session.events",
    "oaep.session.events.stream", "event.cursor_expired",
})
LEGACY_REQUIRED = frozenset({
    "conversation.snapshot", "session.event.resume", "session.event.stream",
    "session.event.cursor_expired",
})


@dataclass(frozen=True)
class ConversationProtocolSelection:
    selected: str
    version: str | None
    schema_hash: str | None
    fallback_reason: str | None
    upgrade_action: str | None


def select_conversation_protocol(
    capabilities: Sequence[str],
    protocols: Mapping[str, Any] | None = None,
    *,
    force_legacy: bool = False,
) -> ConversationProtocolSelection:
    advertised = frozenset(str(value) for value in capabilities)
    values = protocols or {}
    oaep = values.get("oaep") if isinstance(values.get("oaep"), Mapping) else None
    profiles = frozenset(str(value) for value in (oaep or {}).get("profiles", []))
    oaep_signals = oaep is not None or any(value.startswith("oaep.") for value in advertised)
    oaep_complete = bool(
        oaep
        and oaep.get("version") == OAEP_VERSION
        and OAEP_PROFILE in profiles
        and oaep.get("schema_sha256") == OAEP_SCHEMA_SHA256
        and OAEP_REQUIRED.issubset(advertised)
    )
    if oaep_signals and not oaep_complete:
        raise ValueError("oaep_capability_partial")
    if oaep_complete and not force_legacy:
        return ConversationProtocolSelection(
            "oaep", OAEP_VERSION, OAEP_SCHEMA_SHA256, None, None,
        )
    if LEGACY_REQUIRED.issubset(advertised):
        return ConversationProtocolSelection(
            "legacy", "1", None,
            "operator_rollback" if force_legacy else "oaep_unavailable",
            "disable_operator_rollback" if force_legacy and oaep_complete else "upgrade_runtime",
        )
    return ConversationProtocolSelection(
        "unavailable", None, None, "legacy_unavailable", "upgrade_runtime",
    )
