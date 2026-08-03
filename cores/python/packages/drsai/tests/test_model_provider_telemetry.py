from __future__ import annotations

import pytest

from drsai.config import ConfigError, ConfigUpdateRequest, clear_telemetry, commit_update, preview_update, restore_last_known_good, telemetry_snapshot
from drsai.config.revisions import config_revision


def test_telemetry_contains_only_stable_classification_counts(tmp_path, monkeypatch) -> None:
    from drsai.config import service as service_module
    clear_telemetry()
    path = tmp_path / "config.toml"
    secret = "telemetry-secret-must-not-appear"
    monkeypatch.setattr(service_module, "store_credential", lambda _secret: "drsai-credential:00000000-0000-0000-0000-000000000001")
    monkeypatch.setattr(service_module, "delete_credential", lambda _reference: True)
    with pytest.raises(ConfigError):
        commit_update(
            ConfigUpdateRequest(
                provider_name="broken",
                provider_values={"base_url": "invalid"},
                provider_secret=secret,
            ),
            path=path,
            environ={},
        )
    snapshot = telemetry_snapshot()
    assert snapshot["config_commit_failed"] == 1
    assert secret not in repr(snapshot)


def test_write_kill_switch_preserves_existing_config(tmp_path, monkeypatch) -> None:
    path = tmp_path / "config.toml"
    path.write_text('model = "before"\nmodel_provider = "hepai"\n', encoding="utf-8")
    before = path.read_bytes()
    monkeypatch.setenv("DRSAI_MODEL_CONFIG_WRITES", "disabled")
    with pytest.raises(ConfigError, match="writes are disabled"):
        commit_update(
            ConfigUpdateRequest(model="after", model_provider="hepai"),
            path=path,
            environ={},
        )
    assert path.read_bytes() == before
    assert telemetry_snapshot()["config_write_disabled"] == 1


def test_rollout_rehearsal_records_preview_restore_and_recovery_without_values(tmp_path, monkeypatch) -> None:
    clear_telemetry()
    path = tmp_path / "config.toml"
    preview = preview_update(ConfigUpdateRequest(model="baseline", model_provider="hepai"), path=path, environ={})
    assert preview.base_revision == config_revision(path)
    committed = commit_update(ConfigUpdateRequest(model="baseline", model_provider="hepai"), path=path, environ={})
    baseline = path.read_bytes()

    monkeypatch.setenv("DRSAI_MODEL_CONFIG_WRITES", "disabled")
    with pytest.raises(ConfigError, match="writes are disabled"):
        commit_update(ConfigUpdateRequest(model="must-not-apply", model_provider="hepai"), path=path, environ={})
    assert path.read_bytes() == baseline

    monkeypatch.delenv("DRSAI_MODEL_CONFIG_WRITES")
    path.write_text('model = "broken"\nmodel_provider = "missing"\n', encoding="utf-8")
    corrupted_revision = config_revision(path)
    restored = restore_last_known_good(path=path, environ={}, expected_revision=corrupted_revision)
    assert restored.config.model == "baseline"
    assert restored.previous_revision == corrupted_revision
    assert path.read_bytes() == baseline

    snapshot = telemetry_snapshot()
    assert snapshot["config_preview_succeeded"] == 1
    assert snapshot["config_commit_succeeded"] == 1
    assert snapshot["config_write_disabled"] == 1
    assert snapshot["config_restore_succeeded"] == 1
    assert "baseline" not in repr(snapshot)
    assert "missing" not in repr(snapshot)
