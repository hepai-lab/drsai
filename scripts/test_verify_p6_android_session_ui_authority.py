from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _module():
    path = ROOT / "scripts/verify_p6_android_session_ui_authority.py"
    spec = importlib.util.spec_from_file_location("p6_session_ui_authority", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_current_session_ui_has_one_authority() -> None:
    assert _module().verify() == {
        "derived_fields": 4, "generation_fenced": True, "passed": True,
    }


def test_direct_online_write_fails_closed(monkeypatch, tmp_path: Path) -> None:
    module = _module()
    fake = tmp_path / "RemoteSessionViewModel.kt"
    fake.write_text(
        module.VIEW_MODEL.read_text(encoding="utf-8") + "\nval invalid = copy(online = false)\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(module, "VIEW_MODEL", fake)
    try:
        module.verify()
    except ValueError as failure:
        assert str(failure) == "p6_session_ui_direct_write:online"
    else:
        raise AssertionError("duplicate UI authority must fail closed")
