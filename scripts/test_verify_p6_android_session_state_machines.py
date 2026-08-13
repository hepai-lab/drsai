from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _module():
    path = ROOT / "scripts/verify_p6_android_session_state_machines.py"
    spec = importlib.util.spec_from_file_location("p6_session_machines", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_session_view_model_uses_five_pure_state_machines() -> None:
    assert _module().verify() == {"machines": 5, "direct_http": 0, "passed": True}


def test_direct_http_in_view_model_fails_closed(monkeypatch, tmp_path: Path) -> None:
    module = _module()
    fake = tmp_path / "RemoteSessionViewModel.kt"
    current = module.VIEW_MODEL.read_text(encoding="utf-8")
    fake.write_text(current + "\nval bypass = OkHttpClient()\n", encoding="utf-8")
    monkeypatch.setattr(module, "VIEW_MODEL", fake)
    try:
        module.verify()
    except ValueError as failure:
        assert str(failure).startswith("p6_session_view_model_direct_http:")
    else:
        raise AssertionError("direct HTTP construction must fail closed")
