from __future__ import annotations

import tomllib
from pathlib import Path

import pytest

from drsai.config import ConfigError, delete_provider, load_user_config, remove_legacy_model_selection, update_model_selection, upsert_provider
from drsai.config import writer as writer_module
from drsai.config.defaults import CURRENT_CONFIG_VERSION


def test_update_preserves_platform_tables_and_comments(tmp_path: Path) -> None:
    path = tmp_path / "config.toml"
    path.write_text(
        '''# keep this comment
active_platform = "production"

[platforms.production]
portal_url = "https://ai.example.test"
base_url = "https://api.example.test"
''',
        encoding="utf-8",
    )
    update_model_selection(model="deepseek-chat", model_provider="custom", path=path)
    text = path.read_text(encoding="utf-8")
    parsed = tomllib.loads(text)

    assert "# keep this comment" in text
    assert parsed["active_platform"] == "production"
    assert parsed["model"] == "deepseek-chat"
    assert parsed["model_provider"] == "custom"
    assert parsed["config_version"] == CURRENT_CONFIG_VERSION
    assert path.with_suffix(".toml.bak").exists()


def test_remove_legacy_model_selection_preserves_provider_and_unrelated_fields(tmp_path: Path) -> None:
    path = tmp_path / "config.toml"
    path.write_text(
        'config_version = 2\nmodel = "legacy"\nmodel_provider = "custom"\nkeep = "yes"\n\n'
        '[model_providers.custom]\nbase_url = "https://example.test/v1"\nrequires_api_key = false\n',
        encoding="utf-8",
    )

    remove_legacy_model_selection(path=path)

    parsed = tomllib.loads(path.read_text(encoding="utf-8"))
    assert "model" not in parsed
    assert "model_provider" not in parsed
    assert parsed["keep"] == "yes"
    assert parsed["model_providers"]["custom"]["base_url"] == "https://example.test/v1"


def test_upsert_and_delete_provider_without_touching_other_tables(tmp_path: Path) -> None:
    path = tmp_path / "config.toml"
    path.write_text('[desktop]\ntheme = "dark"\n', encoding="utf-8")
    upsert_provider(
        "custom",
        {"base_url": "https://example.test/v1", "api_key_env": "CUSTOM_KEY"},
        path=path,
    )
    parsed = tomllib.loads(path.read_text(encoding="utf-8"))
    assert parsed["desktop"]["theme"] == "dark"
    assert parsed["model_providers"]["custom"]["api_key_env"] == "CUSTOM_KEY"

    upsert_provider(
        "custom",
        {
            "base_url": "http://127.0.0.1:11434/v1",
            "requires_api_key": True,
        },
        path=path,
    )
    parsed = tomllib.loads(path.read_text(encoding="utf-8"))
    assert parsed["model_providers"]["custom"]["requires_api_key"] is True
    assert parsed["model_providers"]["custom"]["api_key_env"] == "CUSTOM_KEY"

    upsert_provider(
        "custom",
        {
            "base_url": "http://127.0.0.1:11434/v1",
            "requires_api_key": False,
        },
        path=path,
    )
    parsed = tomllib.loads(path.read_text(encoding="utf-8"))
    assert "api_key_env" not in parsed["model_providers"]["custom"]

    assert delete_provider("custom", path=path) is True
    assert delete_provider("custom", path=path) is False
    parsed = tomllib.loads(path.read_text(encoding="utf-8"))
    assert "model_providers" not in parsed
    assert parsed["desktop"]["theme"] == "dark"


def test_writer_separates_provider_tables_with_one_blank_line(tmp_path: Path) -> None:
    path = tmp_path / "config.toml"
    upsert_provider("first", {"base_url": "https://first.example/v1", "requires_api_key": False}, path=path)
    upsert_provider("second", {"base_url": "https://second.example/v1", "requires_api_key": False}, path=path)
    text = path.read_text(encoding="utf-8")
    assert "requires_api_key = false\n\n[model_providers.second]" in text
    assert "\n\n\n[model_providers.second]" not in text


def test_writer_rejects_unknown_or_conflicting_fields(tmp_path: Path) -> None:
    path = tmp_path / "config.toml"
    with pytest.raises(ConfigError, match="Unsupported"):
        upsert_provider("custom", {"headers": "unsafe"}, path=path)
    with pytest.raises(ConfigError, match="only one"):
        upsert_provider(
            "custom",
            {"api_key": "secret", "api_key_env": "CUSTOM_KEY"},
            path=path,
        )


def test_writer_escapes_toml_strings(tmp_path: Path) -> None:
    path = tmp_path / "config.toml"
    update_model_selection(model='model"quoted', model_provider="custom", path=path)
    assert tomllib.loads(path.read_text(encoding="utf-8"))["model"] == 'model"quoted'


def test_writer_round_trips_model_aliases(tmp_path: Path) -> None:
    path = tmp_path / "config.toml"
    upsert_provider(
        "custom",
        {
            "base_url": "https://example.test/v1",
            "requires_api_key": False,
            "models": ["vendor/model-a", "vendor/model-b"],
            "model_aliases": {"vendor/model-a": "Fast", "vendor/model-b": "Vision \"Pro\""},
            "model_upstream_ids": {"vendor/model-a": "upstream/a", "vendor/model-b": "upstream/b"},
        },
        path=path,
    )

    provider = tomllib.loads(path.read_text(encoding="utf-8"))["model_providers"]["custom"]
    assert provider == {
        "base_url": "https://example.test/v1",
        "requires_api_key": False,
        "models_file": "configs/models/provider_custom.toml",
    }
    catalog = tomllib.loads((tmp_path / provider["models_file"]).read_text(encoding="utf-8"))["models"]
    assert catalog["vendor/model-a"]["alias"] == "Fast"
    assert catalog["vendor/model-b"]["alias"] == 'Vision "Pro"'
    assert catalog["vendor/model-a"]["upstream_id"] == "upstream/a"
    assert catalog["vendor/model-b"]["upstream_id"] == "upstream/b"


def test_writer_round_trips_model_operations(tmp_path: Path) -> None:
    path = tmp_path / "config.toml"
    upsert_provider(
        "custom",
        {
            "base_url": "https://example.test/v1", "wire_api": "openai",
            "requires_api_key": False, "models": ["image-model"],
            "model_operations": {"image-model": ["image_generation", "image_edit"]},
        },
        path=path,
    )

    provider = tomllib.loads(path.read_text(encoding="utf-8"))["model_providers"]["custom"]
    catalog = tomllib.loads((tmp_path / provider["models_file"]).read_text(encoding="utf-8"))["models"]
    assert catalog["image-model"]["capabilities"] == ["chat", "image_generation", "image_edit"]


def test_writer_round_trips_structured_models_without_parallel_fields(tmp_path: Path) -> None:
    path = tmp_path / "config.toml"
    upsert_provider("google", {
        "base_url": "https://generativelanguage.googleapis.com/v1beta",
        "wire_api": "gemini",
        "requires_api_key": False,
        "models": {
            "gemini-2.5-pro": {
                "alias": "Gemini Pro",
                "input_modalities": ["text", "image"],
                "output_modalities": ["text"],
                "api_protocol": "gemini",
                "enabled": True,
                "capabilities": ["chat", "tool_calling"],
            }
        },
    }, path=path)
    provider = tomllib.loads(path.read_text(encoding="utf-8"))["model_providers"]["google"]
    assert "models" not in provider
    assert provider["models_file"] == "configs/models/provider_google.toml"
    catalog = tomllib.loads((tmp_path / provider["models_file"]).read_text(encoding="utf-8"))["models"]
    assert catalog["gemini-2.5-pro"]["api_protocol"] == "gemini"
    assert catalog["gemini-2.5-pro"]["input_modalities"] == ["text", "image"]
    assert catalog["gemini-2.5-pro"]["output_modalities"] == ["text"]
    assert "modalities" not in catalog["gemini-2.5-pro"]
    assert "model_aliases" not in provider
    assert "model_operations" not in provider
    loaded = load_user_config(path).providers["google"]
    assert loaded.models_file == "configs/models/provider_google.toml"
    assert loaded.models == ("gemini-2.5-pro",)
    assert loaded.model_configs["gemini-2.5-pro"].api_protocol == "gemini"


def test_loader_rejects_models_file_outside_config_root(tmp_path: Path) -> None:
    path = tmp_path / "config.toml"
    path.write_text(
        '[model_providers.custom]\nbase_url = "https://example.test/v1"\nmodels_file = "../outside.toml"\n',
        encoding="utf-8",
    )
    with pytest.raises(ConfigError, match="inside the config directory"):
        load_user_config(path)


def test_writer_round_trips_and_removes_optional_protocol_hosts(tmp_path: Path) -> None:
    path = tmp_path / "config.toml"
    upsert_provider("other", {
        "base_url": "https://other.example/v1",
        "wire_api": "openai",
        "requires_api_key": False,
    }, path=path)
    upsert_provider("multi", {
        "base_url": "https://example.test/v1",
        "anthropic_base_url": "https://example.test/anthropic",
        "google_base_url": "https://example.test/google",
        "wire_api": "openai",
        "requires_api_key": False,
    }, path=path)

    provider = tomllib.loads(path.read_text(encoding="utf-8"))["model_providers"]["multi"]
    assert provider["anthropic_base_url"] == "https://example.test/anthropic"
    assert provider["google_base_url"] == "https://example.test/google"
    assert "wire_api" not in provider

    upsert_provider("multi", {
        "base_url": "https://example.test/v1",
        "wire_api": "openai",
        "requires_api_key": False,
    }, path=path)
    provider = tomllib.loads(path.read_text(encoding="utf-8"))["model_providers"]["multi"]
    assert "anthropic_base_url" not in provider
    assert "google_base_url" not in provider
    other = tomllib.loads(path.read_text(encoding="utf-8"))["model_providers"]["other"]
    assert other == {
        "base_url": "https://other.example/v1",
        "requires_api_key": False,
    }


def test_writer_persists_credential_and_protocol_hosts_without_provider_wire_api(tmp_path: Path) -> None:
    path = tmp_path / "config.toml"
    reference = "drsai-credential:00000000-0000-0000-0000-000000000000"
    upsert_provider("hepai", {
        "base_url": "https://aiapi.ihep.ac.cn/apiv2",
        "anthropic_base_url": "https://aiapi.ihep.ac.cn/apiv2/anthropic",
        "google_base_url": "https://aiapi.ihep.ac.cn/apiv2/google",
        "api_key_credential": reference,
        "wire_api": "openai",
        "requires_api_key": True,
    }, path=path)
    provider = tomllib.loads(path.read_text(encoding="utf-8"))["model_providers"]["hepai"]
    assert provider["api_key_credential"] == reference
    assert provider["anthropic_base_url"].endswith("/anthropic")
    assert provider["google_base_url"].endswith("/google")
    assert "wire_api" not in provider


@pytest.mark.parametrize("failure_point", ["fsync", "replace", "chmod"])
def test_atomic_writer_failure_preserves_previous_config(tmp_path: Path, monkeypatch, failure_point: str) -> None:
    path = tmp_path / "config.toml"
    path.write_text('model = "before"\nmodel_provider = "hepai"\n', encoding="utf-8")
    before = path.read_bytes()
    if failure_point == "fsync":
        monkeypatch.setattr(writer_module.os, "fsync", lambda _fd: (_ for _ in ()).throw(OSError("fsync failed")))
    elif failure_point == "replace":
        monkeypatch.setattr(writer_module.os, "replace", lambda *_args: (_ for _ in ()).throw(OSError("replace failed")))
    else:
        original_chmod = Path.chmod
        calls = {"count": 0}
        def fail_final_chmod(self, mode):
            calls["count"] += 1
            if self == path:
                raise OSError("chmod failed")
            return original_chmod(self, mode)
        monkeypatch.setattr(Path, "chmod", fail_final_chmod)

    with pytest.raises(ConfigError, match="commit failed"):
        writer_module.replace_config_text('model = "after"\nmodel_provider = "hepai"\n', path=path)
    assert path.read_bytes() == before
