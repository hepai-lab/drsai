from __future__ import annotations

import importlib.util
import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/generate_remote_workspace_legacy_inventory_p6.py"
INVENTORY = ROOT / "cores/protocol/relay/remote-workspace-legacy-inventory.json"


def _module():
    spec = importlib.util.spec_from_file_location("p6_legacy_inventory", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_inventory_is_generated_complete_and_rollback_bound() -> None:
    module = _module()
    generated = module.generate()
    stored = json.loads(INVENTORY.read_text(encoding="utf-8"))
    assert stored == generated
    assert len(stored["items"]) == 11
    assert {row["kind"] for row in stored["items"]} == {
        "route", "dto", "table", "subscription", "adapter", "selector", "telemetry",
    }
    assert all(row["rollback_owner_included"] is True for row in stored["items"])
    assert stored["policy"]["long_observation_window_required"] is False
    assert stored["policy"]["delete_only_when"] == [
        "oaep_client_ratio>=0.999", "legacy_request_ratio<0.001",
        "fallback_error_rate<=0.001", "migration_ratio=1",
        "supported_runtime_requires_legacy=false", "rollback_artifact_verified=true",
        "transcript_hash_preserved=true", "database_migration_verified=true",
    ]


def test_oaep_cores_do_not_import_legacy_adapters() -> None:
    roots = (
        ROOT / "cores/python/packages/drsai/src/drsai/oaep",
        ROOT / "apps/android/app/src/main/java/ai/drsai/remote/runtime/oaep",
    )
    for root in roots:
        for path in root.rglob("*"):
            if path.suffix not in {".py", ".kt", ".ts"}:
                continue
            source = path.read_text(encoding="utf-8")
            assert "drsai.compatibility" not in source
            assert "LegacyConversationAdapter" not in source
    desktop = (ROOT / "apps/desktop/shared/main/oaepSessionStream.ts").read_text(encoding="utf-8")
    assert "legacyConversationAdapter" not in desktop
    assert "LegacyConversationAdapter" not in desktop


def test_generator_fails_closed_when_declared_marker_disappears(monkeypatch) -> None:
    module = _module()
    original = module.ENTRIES
    row = list(original[0])
    row[3] = "marker-that-does-not-exist"
    monkeypatch.setattr(module, "ENTRIES", (tuple(row), *original[1:]))
    try:
        module.generate()
    except ValueError as failure:
        assert str(failure) == "p6_legacy_inventory_marker_missing:relay-conversation-routes"
    else:
        raise AssertionError("missing Legacy marker must fail closed")
