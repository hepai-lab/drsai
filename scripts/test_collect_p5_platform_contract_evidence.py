from __future__ import annotations

import io
import hashlib
import json

import pytest

import collect_p5_platform_contract_evidence as collector
from finalize_remote_workspace_p5 import platform_contract_sha256


class Response:
    status = 200
    def __init__(self, value: dict) -> None:
        self.raw = json.dumps(value).encode()
    def __enter__(self): return self
    def __exit__(self, *_args): return None
    def read(self): return self.raw
    def geturl(self): return "https://relay.example/v2/openapi.json"


def _document(**changes) -> dict:
    digest = platform_contract_sha256()
    value = {
        "openapi": "3.1.0", "info": {"version": "2.0.0"},
        "paths": {
            collector.CATALOG: {"get": {
                collector.EXTENSION: digest,
                "responses": {"200": {"content": {"text/event-stream": {}}}},
            }},
            collector.USAGE: {"get": {collector.EXTENSION: digest}},
            collector.DELETION_DECISION: {"get": {
                collector.EXTENSION: digest,
                "responses": {"200": {"content": {"application/json": {
                    "schema": {"$ref": "#/components/schemas/ProtocolDeletionDecision"},
                }}}},
            }},
            collector.PUSH_REGISTRATION: {
                "put": {
                    collector.EXTENSION: digest,
                    "requestBody": {"content": {"application/json": {
                        "schema": {"$ref": "#/components/schemas/PushRegistrationRequest"},
                    }}},
                    "responses": {"200": {"content": {"application/json": {
                        "schema": {"$ref": "#/components/schemas/PushRegistrationResult"},
                    }}}},
                },
                "delete": {
                    collector.EXTENSION: digest,
                    "responses": {"200": {"content": {"application/json": {
                        "schema": {"$ref": "#/components/schemas/PushRegistrationResult"},
                    }}}},
                },
            },
        },
        "components": {"schemas": {
            "SessionCatalogEvent": {"type": "object"},
            "PushRegistrationRequest": {"type": "object"},
            "PushRegistrationResult": {"type": "object"},
            "ProtocolDeletionDecision": {"type": "object"},
        }},
    }
    value.update(changes)
    return value


def test_exact_public_deployment_contract_produces_attestation(monkeypatch, tmp_path) -> None:
    monkeypatch.setattr(collector, "urlopen", lambda *args, **kwargs: Response(_document()))
    openapi = tmp_path / "openapi.json"
    result = collector.collect("https://relay.example", "env-one", openapi_output=openapi)
    assert result["passed"] is True
    assert result["platform_contract_sha256"] == platform_contract_sha256()
    assert result["openapi_bytes"] > 0 and len(result["verified_endpoints"]) == 5
    assert openapi.is_file()
    assert hashlib.sha256(openapi.read_bytes()).hexdigest() == result["openapi_sha256"]


@pytest.mark.parametrize("case", ["http", "missing", "deletion_missing", "push_missing", "drift", "push_drift", "media", "schema", "push_schema", "deletion_schema"])
def test_insecure_incomplete_and_drifted_deployments_fail_closed(monkeypatch, case: str) -> None:
    document = _document()
    if case == "missing": document["paths"].pop(collector.USAGE)
    elif case == "deletion_missing": document["paths"].pop(collector.DELETION_DECISION)
    elif case == "push_missing": document["paths"][collector.PUSH_REGISTRATION].pop("delete")
    elif case == "drift": document["paths"][collector.USAGE]["get"][collector.EXTENSION] = "a" * 64
    elif case == "push_drift": document["paths"][collector.PUSH_REGISTRATION]["put"][collector.EXTENSION] = "a" * 64
    elif case == "media": document["paths"][collector.CATALOG]["get"]["responses"] = {}
    elif case == "schema": document["components"]["schemas"] = {}
    elif case == "push_schema": document["paths"][collector.PUSH_REGISTRATION]["put"]["requestBody"] = {}
    elif case == "deletion_schema": document["paths"][collector.DELETION_DECISION]["get"]["responses"] = {}
    monkeypatch.setattr(collector, "urlopen", lambda *args, **kwargs: Response(document))
    with pytest.raises(RuntimeError):
        collector.collect("http://relay.example" if case == "http" else "https://relay.example", "env")
