from __future__ import annotations

import ast
import json
import subprocess
import sys
from pathlib import Path

from drsai.backend.codex_adapter.bridge_transport import ALLOWED_CLIENT_METHODS
from drsai.backend.codex_adapter.stable_contract import (
    CLIENT_METHODS,
    CLIENT_METHOD_PARAMS,
    CLIENT_REQUIRED_PARAMS,
    CONTRACT_DIGEST,
    SEMANTIC_DISPOSITIONS,
    SEMANTIC_NOTIFICATIONS,
    CodexCompatibility,
    SemanticDisposition,
    STABLE_NOTIFICATIONS,
    NotificationClass,
    classify_notification,
    compatibility_for_version,
    compatibility_for_identity,
    semantic_disposition,
    validate_client_method,
    validate_server_request,
)


ROOT = Path(__file__).parents[1] / "src" / "drsai" / "backend" / "codex_adapter"
REPOSITORY = Path(__file__).resolve().parents[5]


def test_all_literal_rpc_calls_are_pinned_and_bridge_allows_exact_client_surface() -> None:
    called: set[str] = set()
    sources = ""
    for path in ROOT.glob("*.py"):
        source = path.read_text(encoding="utf-8")
        sources += source
        tree = ast.parse(source, filename=str(path))
        for node in ast.walk(tree):
            if not isinstance(node, ast.Call) or not isinstance(node.func, ast.Attribute):
                continue
            if node.func.attr not in {"request", "notify"} or not node.args:
                continue
            if isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str):
                called.add(node.args[0].value)
    assert called <= CLIENT_METHODS, f"Unreviewed Codex client methods: {sorted(called - CLIENT_METHODS)}"
    assert ALLOWED_CLIENT_METHODS == CLIENT_METHODS
    for required in {"thread/list", "thread/archive", "thread/unarchive"}:
        assert required in CLIENT_METHODS and f'"{required}"' in sources


def test_generated_client_parameter_contract_rejects_unknown_methods_and_fields() -> None:
    assert set(CLIENT_METHOD_PARAMS) == set(CLIENT_METHODS)
    assert set(CLIENT_REQUIRED_PARAMS) == set(CLIENT_METHODS)
    validate_client_method("thread/read", {"threadId": "t", "includeTurns": True})
    validate_client_method("initialized", {})
    for method, params in (
        ("thread/read", {"threadId": "t", "secretOverride": True}),
        ("thread/read", {}),
        ("future/private", {}),
    ):
        try:
            validate_client_method(method, params)
        except ValueError:
            pass
        else:
            raise AssertionError(f"invalid client call was accepted: {method}")
    validate_server_request("item/commandExecution/requestApproval", {})
    for method, params in (("turn/start", {}), ("item/fileChange/requestApproval", [])):
        try:
            validate_server_request(method, params)
        except ValueError:
            pass
        else:
            raise AssertionError(f"invalid server request was accepted: {method}")


def test_every_pinned_notification_has_exactly_one_reviewed_class() -> None:
    classified = {method: classify_notification(method) for method in STABLE_NOTIFICATIONS}
    assert len(classified) == len(STABLE_NOTIFICATIONS)
    assert all(value is not NotificationClass.UNKNOWN for value in classified.values())
    assert classify_notification("future/private") is NotificationClass.UNKNOWN


def test_every_semantic_notification_has_one_machine_readable_disposition() -> None:
    assert set(SEMANTIC_DISPOSITIONS) == set(SEMANTIC_NOTIFICATIONS)
    assert len(SEMANTIC_DISPOSITIONS) == 23
    for method, record in SEMANTIC_DISPOSITIONS.items():
        assert semantic_disposition(method) in {
            SemanticDisposition.MAPPED,
            SemanticDisposition.REVIEWED_IGNORED,
            SemanticDisposition.RELEASE_BLOCKED,
        }
        assert record["handler"]
        assert record["oaep"]
        assert record["reason"]
    assert semantic_disposition("item/fileChange/outputDelta") is SemanticDisposition.REVIEWED_IGNORED
    assert semantic_disposition("future/private") is None


def test_contract_binding_is_generated_deterministically_from_the_only_manifest() -> None:
    manifest_path = REPOSITORY / "cores/protocol/codex-app-server-stable-contract.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert manifest["contractVersion"] == 5
    assert len(CONTRACT_DIGEST) == 64
    script = REPOSITORY / "cores/python/packages/drsai/scripts/generate_codex_stable_contract.py"
    result = subprocess.run([sys.executable, str(script), "--check"], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr


def test_contract_classifies_current_schema_and_blocks_unreviewed_versions() -> None:
    manifest = json.loads((REPOSITORY / "cores/protocol/codex-app-server-stable-contract.json").read_text(encoding="utf-8"))
    baseline = manifest["generatedBaseline"]["codexVersion"]
    assert compatibility_for_version(baseline) is CodexCompatibility.EXACT
    assert compatibility_for_version("0.142.5") is CodexCompatibility.REVIEWED_COMPATIBLE
    assert compatibility_for_version("0.144.5") is CodexCompatibility.REVIEWED_COMPATIBLE
    assert compatibility_for_version("0.146.0-alpha.9.2") is CodexCompatibility.REVIEWED_COMPATIBLE
    assert compatibility_for_version("0.147.0-alpha.1.2") is CodexCompatibility.REVIEWED_COMPATIBLE
    assert compatibility_for_version("999.0.0") is CodexCompatibility.BLOCKED
    assert compatibility_for_identity(baseline, "sha256:7d79fe309dd7520843459070f3884ecf0e39cee2620c1c49aad6efb4eca76ecb") is CodexCompatibility.EXACT
    assert compatibility_for_identity(baseline, "sha256:" + "0" * 64) is CodexCompatibility.BLOCKED
    assert compatibility_for_identity("0.144.5", "0da5949167c30a09e459d94559e1ada6910d6ca503a5b5f0e09c0f8eae5ae931") is CodexCompatibility.REVIEWED_COMPATIBLE
    assert classify_notification("thread/environment/connected") is NotificationClass.KNOWN_IGNORED
    assert classify_notification("thread/environment/disconnected") is NotificationClass.KNOWN_IGNORED
    assert NotificationClass.USER_NOTICE in {
        classify_notification(method) for method in manifest["notifications"]["user_notice"]
    }


def test_schema_contract_verifier_reports_complete_current_coverage() -> None:
    script = REPOSITORY / "cores/python/packages/drsai/scripts/verify_codex_stable_contract.py"
    result = subprocess.run([sys.executable, str(script)], capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report == {
        "bundleSha256": "80cecd56a6883f2c9c39580122f2adc08b7cc0ad1f24705fd7d917c1651d598c",
        "clientMethods": 15,
        "codexVersion": "0.147.0-alpha.6.6",
        "contractVersion": 5,
        "notifications": 70,
        "passed": True,
        "semanticDispositions": 23,
        "semanticDispositionCounts": {"mapped": 22, "release_blocked": 0, "reviewed_ignored": 1},
        "serverRequests": 10,
        "contentRetained": False,
    }
