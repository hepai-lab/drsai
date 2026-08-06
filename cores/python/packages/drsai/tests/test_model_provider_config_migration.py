from __future__ import annotations

import json
import tomllib
from pathlib import Path
import pytest

from drsai.config import migrate_legacy_model_config
from drsai.config import migration as migration_module


def test_migrates_legacy_yaml_without_copying_secret(tmp_path: Path) -> None:
    target = tmp_path / "config.toml"
    target.write_text(
        '''active_platform = "production"

[platforms.production]
base_url = "https://platform.example"
''',
        encoding="utf-8",
    )
    original = target.read_bytes()
    legacy = tmp_path / "config.yaml"
    legacy.write_text(
        '''model:
  provider: anthropic
  default: claude-sonnet-4-6
  base_url: https://anthropic.example/v1
''',
        encoding="utf-8",
    )
    cli = tmp_path / "cli.json"
    cli.write_text(json.dumps({"anthropic_api_key": "must-not-copy"}), encoding="utf-8")

    result = migrate_legacy_model_config(
        config_path=target,
        legacy_yaml_path=legacy,
        cli_config_path=cli,
        llm_catalog_path=tmp_path / "missing.yaml",
        environ={},
    )
    text = target.read_text(encoding="utf-8")
    parsed = tomllib.loads(text)

    assert result.migrated is True
    assert result.provider == "legacy-anthropic"
    assert parsed["model"] == "claude-sonnet-4-6"
    assert parsed["platforms"]["production"]["base_url"] == "https://platform.example"
    assert parsed["model_providers"]["legacy-anthropic"]["api_key_env"] == "ANTHROPIC_API_KEY"
    assert "must-not-copy" not in text
    assert legacy.exists()
    assert cli.exists()
    assert target.with_suffix(".toml.bak").read_bytes() == original


def test_migration_is_idempotent(tmp_path: Path) -> None:
    target = tmp_path / "config.toml"
    target.write_text('model = "already-set"\nmodel_provider = "hepai"\n', encoding="utf-8")
    legacy = tmp_path / "config.yaml"
    legacy.write_text("model:\n  default: other-model\n", encoding="utf-8")
    before = target.read_bytes()

    result = migrate_legacy_model_config(
        config_path=target,
        legacy_yaml_path=legacy,
        cli_config_path=tmp_path / "missing.json",
        llm_catalog_path=tmp_path / "missing.yaml",
        environ={},
    )
    assert result.migrated is False
    assert target.read_bytes() == before


def test_migration_can_be_disabled(tmp_path: Path) -> None:
    target = tmp_path / "config.toml"
    legacy = tmp_path / "config.yaml"
    legacy.write_text("model:\n  default: legacy-model\n", encoding="utf-8")
    result = migrate_legacy_model_config(
        config_path=target,
        legacy_yaml_path=legacy,
        cli_config_path=tmp_path / "missing.json",
        llm_catalog_path=tmp_path / "missing.yaml",
        environ={"DRSAI_CONFIG_AUTO_MIGRATE": "false"},
    )
    assert result.migrated is False
    assert not target.exists()


def test_migration_rolls_back_when_second_write_fails(tmp_path: Path, monkeypatch) -> None:
    target = tmp_path / "config.toml"
    original = b'[desktop]\ntheme = "dark"\n'
    target.write_bytes(original)
    legacy = tmp_path / "config.yaml"
    legacy.write_text(
        "model:\n  provider: openai\n  default: custom-model\n  base_url: https://provider.example/v1\n",
        encoding="utf-8",
    )
    def fail_update(**_kwargs) -> None:
        raise OSError("simulated write failure")

    monkeypatch.setattr(migration_module, "update_model_selection", fail_update)

    with pytest.raises(OSError, match="simulated"):
        migrate_legacy_model_config(
            config_path=target,
            legacy_yaml_path=legacy,
            cli_config_path=tmp_path / "missing.json",
            llm_catalog_path=tmp_path / "missing.yaml",
            environ={},
        )

    assert target.read_bytes() == original


@pytest.mark.parametrize(
    ("environment", "cli_value", "yaml_value", "catalog_value", "expected"),
    [
        ({"LLM_DEFAULT_ALIAS": "environment-model"}, "cli-model", "yaml-model", "catalog-model", "environment-model"),
        ({}, "cli-model", "yaml-model", "catalog-model", "cli-model"),
        ({}, None, "yaml-model", "catalog-model", "yaml-model"),
        ({}, None, None, "catalog-model", "catalog-model"),
    ],
)
def test_legacy_source_precedence_is_deterministic_and_sources_remain_unchanged(
    tmp_path: Path,
    environment: dict[str, str],
    cli_value: str | None,
    yaml_value: str | None,
    catalog_value: str,
    expected: str,
) -> None:
    target = tmp_path / "config.toml"
    yaml_path = tmp_path / "config.yaml"
    cli_path = tmp_path / "cli_config.json"
    catalog_path = tmp_path / "llm_mode_config.yaml"
    yaml_path.write_text(f"model:\n  default: {yaml_value}\n" if yaml_value else "model: {}\n", encoding="utf-8")
    cli_path.write_text(json.dumps({"defult_config_name": cli_value} if cli_value else {}), encoding="utf-8")
    catalog_path.write_text(f"_default_alias: {catalog_value}\n", encoding="utf-8")
    originals = {path: path.read_bytes() for path in (yaml_path, cli_path, catalog_path)}

    result = migrate_legacy_model_config(
        config_path=target,
        legacy_yaml_path=yaml_path,
        cli_config_path=cli_path,
        llm_catalog_path=catalog_path,
        environ=environment,
    )

    assert result.migrated is True
    assert result.model == expected
    assert tomllib.loads(target.read_text(encoding="utf-8"))["model"] == expected
    assert set(result.sources) == {str(yaml_path), str(cli_path), str(catalog_path)}
    assert {path: path.read_bytes() for path in originals} == originals


def test_migration_backup_supports_old_version_rollback_and_repeat_upgrade(tmp_path: Path) -> None:
    target = tmp_path / "config.toml"
    original = b'[desktop]\ntheme = "dark"\n'
    target.write_bytes(original)
    legacy = tmp_path / "config.yaml"
    legacy.write_text("model:\n  default: rollback-model\n", encoding="utf-8")
    arguments = {
        "config_path": target,
        "legacy_yaml_path": legacy,
        "cli_config_path": tmp_path / "missing.json",
        "llm_catalog_path": tmp_path / "missing.yaml",
        "environ": {},
    }

    first = migrate_legacy_model_config(**arguments)
    assert first.migrated is True
    backup = target.with_suffix(".toml.bak")
    assert backup.read_bytes() == original
    target.write_bytes(backup.read_bytes())
    assert "model" not in tomllib.loads(target.read_text(encoding="utf-8"))
    assert legacy.exists()

    second = migrate_legacy_model_config(**arguments)
    assert second.migrated is True
    assert second.model == first.model == "rollback-model"
    assert second.provider == first.provider == "hepai"
