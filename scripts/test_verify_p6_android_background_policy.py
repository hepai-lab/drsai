from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _module():
    path = ROOT / "scripts/verify_p6_android_background_policy.py"
    spec = importlib.util.spec_from_file_location("p6_android_background_policy", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_current_background_policy_is_bounded() -> None:
    assert _module().verify() == {
        "foreground_sse_limit": 1,
        "periodic_work_limit": 1,
        "minimum_interval_minutes": 15,
        "max_attempts": 3,
        "busy_loops": 0,
        "passed": True,
    }


def test_busy_loop_regression_fails_closed(monkeypatch, tmp_path: Path) -> None:
    module = _module()
    fake = tmp_path / "RemoteBackgroundSync.kt"
    fake.write_text(module.POLICY.read_text(encoding="utf-8") + "\nwhile (true) {}\n", encoding="utf-8")
    monkeypatch.setattr(module, "POLICY", fake)
    try:
        module.verify()
    except ValueError as failure:
        assert str(failure) == "p6_background_worker_busy_loop"
    else:
        raise AssertionError("background busy loop must fail closed")
