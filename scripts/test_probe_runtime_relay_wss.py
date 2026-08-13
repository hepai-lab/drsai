from __future__ import annotations

import asyncio
from urllib.parse import parse_qs, urlparse

import pytest

import probe_runtime_relay_wss as probe


def test_connection_url_is_wss_and_binds_runtime_instance_version_and_capabilities() -> None:
    value = probe.connection_url(
        "wss://relay.example/api/runtime-relay/v1/runtime-connect?existing=one",
        runtime_id="runtime-test", instance_id="diagnostic-test", version="1.5.7",
    )
    parsed = urlparse(value)
    query = parse_qs(parsed.query)
    assert parsed.scheme == "wss" and parsed.hostname == "relay.example"
    assert query["runtime_id"] == ["runtime-test"]
    assert query["instance_id"] == ["diagnostic-test"]
    assert query["version"] == ["1.5.7"]
    assert query["capabilities"] and query["existing"] == ["one"]


@pytest.mark.parametrize("value", [
    "https://relay.example/runtime-connect",
    "wss://user:password@relay.example/runtime-connect",
    "wss:///runtime-connect",
])
def test_connection_url_rejects_non_wss_userinfo_and_missing_host(value: str) -> None:
    with pytest.raises(RuntimeError, match="runtime_relay_probe_url_invalid"):
        probe.connection_url(value, runtime_id="r", instance_id="i", version="1")


def test_local_dpapi_failure_returns_only_safe_classification(monkeypatch, tmp_path) -> None:
    secret = "private-dpapi-detail-must-not-leak"

    def fail(_self):
        raise OSError(secret)

    monkeypatch.setattr(probe.RuntimeCredentialStore, "load", fail)
    result = asyncio.run(probe.probe(tmp_path))
    assert result == {
        "status": "failed", "error_code": "local_configuration_error", "error_type": "OSError",
    }
    assert secret not in str(result)
