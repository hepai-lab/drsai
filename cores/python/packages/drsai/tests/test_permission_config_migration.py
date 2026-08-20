from __future__ import annotations

import sqlite3
from pathlib import Path

import pytest

from drsai.backend.runtime.permission_modes import LegacyPermissionConfigMigrationService


@pytest.mark.parametrize("legacy", ["always", "ask", "on-request", "manual", "prompt", "always-ask"])
def test_manual_legacy_values_map_to_manual_safe_without_expansion(tmp_path: Path, legacy: str) -> None:
    service = LegacyPermissionConfigMigrationService(tmp_path / f"{legacy}.sqlite3")
    result = service.migrate("account:workspace", {"desktop": legacy}, now=100)
    assert result.mode_id == "manual_safe"
    assert result.reason_code == "legacy_manual_mapped"
    assert not result.requires_reselection


@pytest.mark.parametrize("legacy", ["auto", "auto-conservative", "auto_review", "auto-reviewed"])
def test_only_conservative_auto_values_map_to_auto_reviewed(tmp_path: Path, legacy: str) -> None:
    service = LegacyPermissionConfigMigrationService(tmp_path / f"{legacy}.sqlite3")
    result = service.migrate("account:workspace", {"personal": legacy}, now=100)
    assert result.mode_id == "auto_reviewed"
    assert result.reason_code == "legacy_conservative_auto_mapped"
    assert not result.requires_reselection


@pytest.mark.parametrize("legacy", [
    "never", "dangerous", "dangerous-on", "full-access", "full_access",
    "bypass", "unrestricted", "auto-permissive", "permissive",
])
def test_dangerous_legacy_values_never_map_to_full_access(tmp_path: Path, legacy: str) -> None:
    service = LegacyPermissionConfigMigrationService(tmp_path / f"danger-{legacy}.sqlite3")
    result = service.migrate("account:workspace", {"legacy_runtime": legacy}, now=100)
    assert result.mode_id == "manual_safe"
    assert result.reason_code == "legacy_dangerous_value_requires_reselection"
    assert result.requires_reselection


def test_conflicting_corrupt_and_repository_values_fail_to_manual_safe(tmp_path: Path) -> None:
    service = LegacyPermissionConfigMigrationService(tmp_path / "runtime.sqlite3")
    conflict = service.migrate(
        "conflict", {"desktop": "auto-conservative", "web": "never"}, now=100,
    )
    assert (conflict.mode_id, conflict.reason_code, conflict.requires_reselection) == (
        "manual_safe", "legacy_values_conflict", True,
    )
    corrupt = service.migrate("corrupt", {"personal": {"attacker": "value"}}, now=100)
    assert corrupt.mode_id == "manual_safe" and corrupt.requires_reselection
    repository = service.migrate("repository", {"repository": "auto-conservative"}, now=100)
    assert repository.mode_id == "manual_safe"
    assert repository.reason_code == "legacy_repository_value_ignored"
    assert repository.repository_value_ignored and repository.requires_reselection


def test_repository_cannot_override_a_trusted_personal_value(tmp_path: Path) -> None:
    service = LegacyPermissionConfigMigrationService(tmp_path / "runtime.sqlite3")
    result = service.migrate(
        "account:workspace", {"personal": "always", "repository": "never"}, now=100,
    )
    assert result.mode_id == "manual_safe" and not result.requires_reselection
    assert result.repository_value_ignored


def test_migration_is_idempotent_secret_free_and_one_time_explanation_is_acknowledgeable(tmp_path: Path) -> None:
    database = tmp_path / "runtime.sqlite3"
    service = LegacyPermissionConfigMigrationService(database)
    first = service.migrate("account:workspace", {"desktop": "unknown-private-value"}, now=100)
    second = service.migrate("account:workspace", {"desktop": "unknown-private-value"}, now=101)
    assert first == second and not first.acknowledged
    assert b"unknown-private-value" not in database.read_bytes()
    acknowledged = service.acknowledge("account:workspace", now=102)
    repeated = service.acknowledge("account:workspace", now=103)
    assert acknowledged.acknowledged and repeated.acknowledged
    event_types = [event.event_type for event in service.audit.list()]
    assert event_types.count("permission_config.explanation_acknowledged") == 1
    with pytest.raises(ValueError, match="different legacy inputs"):
        service.migrate("account:workspace", {"desktop": "always"}, now=104)
    with sqlite3.connect(database) as db:
        with pytest.raises(sqlite3.IntegrityError, match="durable"):
            db.execute("DELETE FROM runtime_permission_config_migrations")
