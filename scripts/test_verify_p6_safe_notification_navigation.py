from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _module():
    path = ROOT / "scripts/verify_p6_safe_notification_navigation.py"
    spec = importlib.util.spec_from_file_location("p6_safe_notification_navigation", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_current_notification_navigation_is_opaque_and_durable() -> None:
    assert _module().verify() == {
        "journeys": 5,
        "payload_fields": 7,
        "content_fields": 0,
        "durable_until_item_focused": True,
        "passed": True,
    }


def test_early_navigation_consumption_fails_closed(monkeypatch, tmp_path: Path) -> None:
    module = _module()
    fake = tmp_path / "OpenDrSaiApp.kt"
    fake.write_text("viewModel.consumeRequestedRoute()", encoding="utf-8")
    monkeypatch.setattr(module, "APP_UI", fake)
    try:
        module.verify()
    except ValueError as failure:
        assert str(failure).startswith("p6_notification_navigation_marker_missing:ui:")
    else:
        raise AssertionError("early navigation consumption must fail closed")
