from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _module():
    path = ROOT / "scripts/verify_p6_push_readiness.py"
    spec = importlib.util.spec_from_file_location("p6_push_readiness", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_current_push_readiness_is_honest_and_foreground_recovers() -> None:
    assert _module().verify() == {
        "matrix_cases": 4,
        "ready_cases": 1,
        "foreground_catch_up": True,
        "honest_degradation": True,
        "passed": True,
    }


def test_missing_foreground_catch_up_fails_closed(monkeypatch, tmp_path: Path) -> None:
    module = _module()
    fake = tmp_path / "OpenDrSaiApp.kt"
    fake.write_text("no foreground hook", encoding="utf-8")
    monkeypatch.setattr(module, "APP", fake)
    try:
        module.verify()
    except ValueError as failure:
        assert str(failure).startswith("p6_push_readiness_marker_missing:app:")
    else:
        raise AssertionError("missing foreground catch-up must fail closed")
