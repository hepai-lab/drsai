from __future__ import annotations

from drsai.config import diagnose_model_config, guidance_for
from drsai.config import doctor as doctor_module


def test_doctor_reports_healthy_keyless_provider(tmp_path) -> None:
    path = tmp_path / "config.toml"
    path.write_text(
        'model = "local"\nmodel_provider = "local"\n'
        '[model_providers.local]\nbase_url = "http://127.0.0.1:11434/v1"\n'
        'requires_api_key = false\n',
        encoding="utf-8",
    )
    result = diagnose_model_config(path=path, environ={})
    assert result["ok"] is True
    ids = [check["id"] for check in result["checks"]]
    assert ids[:2] == ["toml", "revision"]
    assert {"provider", "base_url", "protocol", "credential", "credential_orphans", "last_known_good"} <= set(ids)


def test_doctor_guides_missing_environment_credential(tmp_path) -> None:
    path = tmp_path / "config.toml"
    path.write_text(
        'model = "remote"\nmodel_provider = "remote"\n'
        '[model_providers.remote]\nbase_url = "https://example.test/v1"\n'
        'api_key_env = "MISSING_TEST_KEY"\n',
        encoding="utf-8",
    )
    result = diagnose_model_config(path=path, environ={})
    assert result["ok"] is False
    credential = next(check for check in result["checks"] if check["id"] == "credential")
    assert credential["guidance"]["code"] == "credential_unavailable"
    assert "MISSING_TEST_KEY" in credential["message"]


def test_doctor_detects_corrupt_stored_credential(tmp_path, monkeypatch) -> None:
    path = tmp_path / "config.toml"
    path.write_text(
        'model = "remote"\nmodel_provider = "remote"\n'
        '[model_providers.remote]\nbase_url = "https://example.test/v1"\n'
        'api_key_credential = "drsai-credential:broken"\n',
        encoding="utf-8",
    )
    monkeypatch.setattr(doctor_module, "credential_available", lambda _ref: False)
    result = diagnose_model_config(path=path, environ={})
    assert result["ok"] is False
    credential = next(check for check in result["checks"] if check["id"] == "credential")
    assert credential["guidance"]["code"] == "credential_unavailable"


def test_guidance_has_stable_actionable_shape() -> None:
    value = guidance_for("config_conflict")
    assert set(value) == {"code", "title", "message", "actions", "retryable", "localizations"}
    assert value["actions"]
    assert value["localizations"]["zh"]["actions"]
