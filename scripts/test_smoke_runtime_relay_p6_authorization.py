from __future__ import annotations

import json

import pytest

import smoke_runtime_relay_p6_authorization as smoke


def _health() -> bytes:
    return json.dumps({"status": "ok"}).encode()


def _openapi(extension: object = smoke.EXPECTED) -> bytes:
    return json.dumps({
        "openapi": "3.1.0",
        "info": {"title": "Relay", "version": "2.0.0"},
        "x-association-authorization": extension,
    }).encode()


def test_exact_public_authorization_contract_passes() -> None:
    report = smoke.audit(_health(), _openapi(), "https://relay.example/api/runtime-relay")
    assert report["passed"] is True
    assert report["mutation_performed"] is False
    assert report["authorization_contract"] == smoke.EXPECTED


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("actions", ["read", "send", "approve"]),
        ("workspace_scopes", ["all"]),
        ("authorization_precedes_body_validation", False),
        ("push_requires_read_and_workspace_allowlist", False),
        ("scope_shrink_immediate", False),
    ],
)
def test_missing_or_weakened_authorization_semantics_fail_closed(field: str, value: object) -> None:
    extension = dict(smoke.EXPECTED)
    extension[field] = value
    report = smoke.audit(_health(), _openapi(extension), "https://relay.example/api/runtime-relay")
    assert report["passed"] is False
    assert report["authorization_contract"] is None
    assert "extension_exact" in report["failed_requirements"]


def test_extra_extension_field_and_missing_extension_fail_closed() -> None:
    extension = dict(smoke.EXPECTED)
    extension["subject"] = "forbidden"
    assert smoke.audit(_health(), _openapi(extension), "https://relay.example")["passed"] is False
    source = json.loads(_openapi())
    source.pop("x-association-authorization")
    assert smoke.audit(_health(), json.dumps(source).encode(), "https://relay.example")["passed"] is False


def test_invalid_json_or_shape_is_rejected() -> None:
    with pytest.raises(ValueError, match="json_invalid"):
        smoke.audit(b"not-json", _openapi(), "https://relay.example")
    with pytest.raises(ValueError, match="shape_invalid"):
        smoke.audit(b"[]", _openapi(), "https://relay.example")

