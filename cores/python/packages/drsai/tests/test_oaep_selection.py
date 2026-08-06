from __future__ import annotations

import json
from pathlib import Path

import pytest

from drsai.oaep.generated import OAEP_SCHEMA_SHA256
from drsai.oaep.selection import select_conversation_protocol


MATRIX = Path(__file__).resolve().parents[4] / "protocol" / "relay" / "oaep-version-matrix.json"


def test_shared_version_matrix_has_exact_python_outcomes() -> None:
    cases = json.loads(MATRIX.read_text(encoding="utf-8"))["cases"]
    for case in cases:
        if case["expected"] == "reject":
            with pytest.raises(ValueError, match="oaep_capability_partial"):
                select_conversation_protocol(case["capabilities"], case["protocols"])
            continue
        selected = select_conversation_protocol(case["capabilities"], case["protocols"])
        assert selected.selected == case["expected"], case["name"]
        if selected.selected == "oaep":
            assert selected.version == "1.0"
            assert selected.schema_hash == OAEP_SCHEMA_SHA256
            assert selected.fallback_reason is None
            assert selected.upgrade_action is None


def test_operator_rollback_is_explicit_and_actionable() -> None:
    capabilities = [
        "oaep.v1", "oaep.session.snapshot", "oaep.session.events",
        "oaep.session.events.stream", "event.cursor_expired",
        "conversation.snapshot", "session.event.resume", "session.event.stream",
        "session.event.cursor_expired",
    ]
    selected = select_conversation_protocol(
        capabilities,
        {"oaep": {"version": "1.0", "profiles": ["oaep.session-stream/1"]}},
        force_legacy=True,
    )
    assert selected.selected == "legacy"
    assert selected.fallback_reason == "operator_rollback"
    assert selected.upgrade_action == "disable_operator_rollback"
