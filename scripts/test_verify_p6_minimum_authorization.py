from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _module():
    path = ROOT / "scripts/verify_p6_minimum_authorization.py"
    spec = importlib.util.spec_from_file_location("p6_minimum_authorization", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_current_minimum_authorization_contract_is_complete() -> None:
    assert _module().verify() == {
        "permissions": ["read", "send", "approve", "files"],
        "workspace_allowlist": True,
        "pre_body_denial": True,
        "push_scope_filter": True,
        "desktop_independent_reduction": True,
        "passed": True,
    }


def test_legacy_unscoped_push_fanout_is_rejected(monkeypatch, tmp_path: Path) -> None:
    module = _module()
    fake = tmp_path / "notifications.py"
    fake.write_text(
        module.NOTIFICATIONS.read_text(encoding="utf-8")
        .replace("self.device_resolver(runtime_id, workspace_id)", "self.device_resolver(runtime_id)"),
        encoding="utf-8",
    )
    monkeypatch.setattr(module, "NOTIFICATIONS", fake)
    try:
        module.verify()
    except ValueError as failure:
        assert str(failure).startswith("p6_minimum_authorization_marker_missing:notifications")
    else:
        raise AssertionError("unscoped push fanout must fail closed")
