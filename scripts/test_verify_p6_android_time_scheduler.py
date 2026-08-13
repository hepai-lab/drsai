from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _module():
    path = ROOT / "scripts/verify_p6_android_time_scheduler.py"
    spec = importlib.util.spec_from_file_location("p6_time_scheduler", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_current_remote_time_path_is_injected() -> None:
    assert _module().verify() == {
        "clock_types": 2,
        "frame_schedulers": 2,
        "deterministic_cycles": 100,
        "real_sleep_in_domain_tests": 0,
        "passed": True,
    }


def test_direct_delay_regression_fails_closed(monkeypatch, tmp_path: Path) -> None:
    module = _module()
    fake = tmp_path / "RemoteSessionViewModel.kt"
    fake.write_text(module.SESSION.read_text(encoding="utf-8") + "\ndelay(16L)\n", encoding="utf-8")
    monkeypatch.setattr(module, "SESSION", fake)
    try:
        module.verify()
    except ValueError as failure:
        assert str(failure).startswith("p6_real_delay_remaining:")
    else:
        raise AssertionError("direct real delay must fail closed")
