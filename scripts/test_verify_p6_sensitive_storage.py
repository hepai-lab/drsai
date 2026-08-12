from __future__ import annotations

import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]


def _module():
    path = ROOT / "scripts/verify_p6_sensitive_storage.py"
    spec = importlib.util.spec_from_file_location("p6_sensitive_storage", path)
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_current_sensitive_storage_boundary_is_fail_closed() -> None:
    result = _module().verify()
    assert result["android_backup_domains"] == 9
    assert result["content_free_ledgers"] is True
    assert result["passed"] is True


def test_missing_database_backup_exclusion_is_rejected(monkeypatch, tmp_path: Path) -> None:
    module = _module()
    fake = tmp_path / "backup_rules.xml"
    fake.write_text(
        module.BACKUP_RULES.read_text(encoding="utf-8")
        .replace('<exclude domain="database" path="." />', ""),
        encoding="utf-8",
    )
    monkeypatch.setattr(module, "BACKUP_RULES", fake)
    try:
        module.verify()
    except ValueError as failure:
        assert str(failure) == "p6_sensitive_storage_backup_domain_missing:database"
    else:
        raise AssertionError("missing backup exclusion must fail closed")
