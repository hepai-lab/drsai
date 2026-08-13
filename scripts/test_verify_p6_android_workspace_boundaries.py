from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts/verify_p6_android_workspace_boundaries.py"


def _module():
    spec = importlib.util.spec_from_file_location("p6_android_boundaries", SCRIPT)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_current_android_graph_has_exactly_eight_boundaries() -> None:
    assert _module().verify() == {"boundaries": 8, "bypasses": 0, "passed": True}


def test_public_raw_capability_fails_closed(monkeypatch, tmp_path: Path) -> None:
    module = _module()
    fake = tmp_path / "RemoteWorkspaceContainer.kt"
    fake.write_text("class RemoteWorkspaceContainer { val repository = Unit }", encoding="utf-8")
    monkeypatch.setattr(module, "CONTAINER_FILE", fake)
    try:
        module.verify()
    except ValueError as failure:
        assert str(failure).startswith("p6_android_boundary_wiring_missing:")
    else:
        raise AssertionError("incomplete boundary graph must fail closed")
