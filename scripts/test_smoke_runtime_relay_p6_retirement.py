from __future__ import annotations

import json

import pytest

from smoke_runtime_relay_p6_retirement import audit


def openapi(*, include_runtime_fields: bool = True) -> bytes:
    schemas = {"supported_runtime_count": {"type": "integer"},
               "supported_runtime_requires_legacy": {"type": ["boolean", "null"]}} \
        if include_runtime_fields else {}
    return json.dumps({"openapi": "3.1.0", "info": {"title": "Relay", "version": "2.0.0"},
                       "paths": {path: {} for path in (
                           "/health", "/push/readiness", "/metrics/protocol-usage/deletion-decision",
                           "/metrics/relay-latency")}, "components": {"schemas": schemas}}).encode()


def test_public_retirement_contract_passes_only_with_runtime_compatibility_fields() -> None:
    report = audit(b'{"ok":true}', openapi(), "https://relay.example/api/runtime-relay")
    assert report["passed"] is True and report["failed_requirements"] == []


def test_missing_runtime_fields_or_path_are_reported_without_mutation() -> None:
    report = audit(b'{"ok":true}', openapi(include_runtime_fields=False), "https://relay.example")
    assert report["passed"] is False
    assert report["failed_requirements"] == [
        "supported_runtime_count", "supported_runtime_requires_legacy"
    ]
    assert report["mutation_performed"] is False
    value = json.loads(openapi())
    value["paths"].pop("/push/readiness")
    report = audit(b'{"ok":true}', json.dumps(value).encode(), "https://relay.example")
    assert "push_readiness" in report["failed_requirements"]


def test_invalid_json_or_shape_fails_closed() -> None:
    with pytest.raises(ValueError, match="json_invalid"):
        audit(b"no", openapi(), "https://relay.example")
    with pytest.raises(ValueError, match="shape_invalid"):
        audit(b"[]", openapi(), "https://relay.example")
