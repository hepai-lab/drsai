from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _module():
    path = ROOT / "scripts/verify_p6_android_host_status.py"
    spec = importlib.util.spec_from_file_location("p6_host_status", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_current_host_status_surface_is_product_facing() -> None:
    assert _module().verify() == {
        "product_states": 6,
        "compose_snapshots": 6,
        "internal_ui_fields": 0,
        "passed": True,
    }


def test_internal_field_regression_fails_closed(monkeypatch, tmp_path: Path) -> None:
    module = _module()
    fake = tmp_path / "RemoteWorkspaceScreens.kt"
    fake.write_text(module.SCREEN.read_text(encoding="utf-8") + "\nval connectionGeneration: Long\n", encoding="utf-8")
    monkeypatch.setattr(module, "SCREEN", fake)
    try:
        module.verify()
    except ValueError as failure:
        assert str(failure).startswith("p6_host_ui_internal_field:")
    else:
        raise AssertionError("internal host detail must fail closed")
