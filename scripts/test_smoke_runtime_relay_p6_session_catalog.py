from __future__ import annotations

import json
from pathlib import Path

import pytest

import smoke_runtime_relay_p6_session_catalog as smoke


PATH = "/v2/runtimes/{runtime_id}/workspaces/{workspace_id}/session-catalog-events/stream"
ROOT = Path(__file__).resolve().parents[1]


def _health() -> bytes:
    return b'{"status":"ok"}'


def _openapi(extension: object = smoke.EXPECTED, include_path: bool = True) -> bytes:
    return json.dumps({
        "openapi": "3.1.0",
        "info": {"version": "2.0.0"},
        "paths": {PATH: {"get": {}}} if include_path else {},
        "x-session-catalog-stream": extension,
    }).encode()


def test_exact_session_catalog_contract_passes() -> None:
    report = smoke.audit(_health(), _openapi(), "https://relay.example")
    assert report["passed"] is True
    assert report["mutation_performed"] is False
    assert report["session_catalog_contract"] == smoke.EXPECTED


def test_public_contract_matches_existing_strict_desktop_and_android_clients() -> None:
    desktop = (ROOT / "apps/desktop/shared/main/workspaceSessionCatalog.ts").read_text(encoding="utf-8")
    android = (ROOT / "apps/android/app/src/main/java/ai/drsai/remote/remote/data/WorkspaceSessionCatalog.kt").read_text(encoding="utf-8")
    assert "event_id,sequence,session_id,type" in desktop
    assert 'setOf("event_id", "session_id", "type", "sequence")' in android
    for event in smoke.EXPECTED["events"]:
        assert event in desktop
        assert event in android
    assert smoke.EXPECTED["payload_fields"] == ["event_id", "sequence", "session_id", "type"]


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("post_commit_only", False),
        ("authority_refetch_by_session_id", False),
        ("after_sequence_replay", False),
        ("cursor_expired_fail_closed", False),
        ("cross_worker_fanout", False),
        ("polling_required", True),
        ("events", ["event.session.updated"]),
        ("payload_fields", ["event_id", "sequence", "session_id", "type", "title"]),
        ("scope_fields", ["runtime_id"]),
    ],
)
def test_weakened_or_sensitive_contract_fails_closed(field: str, value: object) -> None:
    extension = dict(smoke.EXPECTED)
    extension[field] = value
    report = smoke.audit(_health(), _openapi(extension), "https://relay.example")
    assert report["passed"] is False
    assert "extension_exact" in report["failed_requirements"]


def test_missing_stream_path_and_extra_contract_field_fail_closed() -> None:
    assert smoke.audit(_health(), _openapi(include_path=False), "https://relay.example")["passed"] is False
    extension = dict(smoke.EXPECTED)
    extension["title"] = "forbidden"
    assert smoke.audit(_health(), _openapi(extension), "https://relay.example")["passed"] is False


def test_invalid_json_or_paths_fail_closed() -> None:
    with pytest.raises(ValueError, match="json_invalid"):
        smoke.audit(b"bad", _openapi(), "https://relay.example")
    source = json.loads(_openapi())
    source["paths"] = []
    with pytest.raises(ValueError, match="paths_invalid"):
        smoke.audit(_health(), json.dumps(source).encode(), "https://relay.example")
