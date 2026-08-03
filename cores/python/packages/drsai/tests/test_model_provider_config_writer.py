from __future__ import annotations

import tomllib
from pathlib import Path

import pytest

from drsai.config import ConfigError, delete_provider, update_model_selection, upsert_provider
from drsai.config import writer as writer_module


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
    assert parsed["config_version"] == 2
    assert path.with_suffix(".toml.bak").exists()


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
