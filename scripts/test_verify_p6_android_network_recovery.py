from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _module():
    path = ROOT / "scripts/verify_p6_android_network_recovery.py"
    spec = importlib.util.spec_from_file_location("p6_android_network_recovery", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_current_network_recovery_is_bounded_and_generation_aware() -> None:
    assert _module().verify() == {
        "network_generation": True,
        "retry_window_ms": 120_000,
        "cursor_snapshot_recovery": True,
        "catalog_single_flight": True,
        "passed": True,
    }


def test_boolean_only_connectivity_regression_fails_closed(monkeypatch, tmp_path: Path) -> None:
    module = _module()
    fake = tmp_path / "AndroidRemoteConnectivity.kt"
    fake.write_text("val online: StateFlow<Boolean>\n", encoding="utf-8")
    monkeypatch.setattr(module, "CONNECTIVITY", fake)
    try:
        module.verify()
    except ValueError as failure:
        assert str(failure).startswith("p6_network_recovery_marker_missing:connectivity:")
    else:
        raise AssertionError("boolean-only connectivity must fail closed")
