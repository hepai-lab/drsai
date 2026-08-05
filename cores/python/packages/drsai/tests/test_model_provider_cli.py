from __future__ import annotations

import json
import tomllib
from pathlib import Path

from typer.testing import CliRunner

from drsai.backend import run_cli
from drsai.config import doctor, loader, locking, revisions, service, writer


def _use_config_path(monkeypatch, path: Path) -> None:
    monkeypatch.setattr(loader, "default_config_path", lambda: path)
    monkeypatch.setattr(writer, "default_config_path", lambda: path)
    monkeypatch.setattr(run_cli, "default_config_path", lambda: path)
    monkeypatch.setattr(service, "default_config_path", lambda: path)
    monkeypatch.setattr(locking, "default_config_path", lambda: path)
    monkeypatch.setattr(revisions, "default_config_path", lambda: path)
    monkeypatch.setattr(doctor, "default_config_path", lambda: path)


def test_cli_creates_provider_and_selects_model(tmp_path: Path, monkeypatch) -> None:
    path = tmp_path / "config.toml"
    _use_config_path(monkeypatch, path)
    runner = CliRunner()
    result = runner.invoke(
        run_cli.app,
        [
            "config",
            "--provider",
            "custom",
            "--base-url",
            "https://provider.example/v1",
            "--api-key-env",
            "CUSTOM_KEY",
            "--model",
            "custom-model",
        ],
    )

    assert result.exit_code == 0, result.output
    parsed = tomllib.loads(path.read_text(encoding="utf-8"))
    assert parsed["model"] == "custom-model"
    assert parsed["model_provider"] == "custom"
    assert parsed["model_providers"]["custom"]["api_key_env"] == "CUSTOM_KEY"


def test_cli_check_and_path_are_non_sensitive(tmp_path: Path, monkeypatch) -> None:
    path = tmp_path / "config.toml"
    path.write_text(
        '''model = "local-model"
model_provider = "local"
[model_providers.local]
base_url = "http://127.0.0.1:11434/v1"
api_key = "must-not-print"
''',
        encoding="utf-8",
    )
    _use_config_path(monkeypatch, path)
    runner = CliRunner()

    checked = runner.invoke(run_cli.app, ["config", "--check"])
    assert checked.exit_code == 0, checked.output
    assert "must-not-print" not in checked.output
    shown_path = runner.invoke(run_cli.app, ["config", "--path"])
    assert shown_path.exit_code == 0
    assert str(path) in shown_path.output


def test_cli_subcommands_match_documented_interface(tmp_path: Path, monkeypatch) -> None:
    path = tmp_path / "config.toml"
    _use_config_path(monkeypatch, path)
    runner = CliRunner()

    added = runner.invoke(
        run_cli.app,
        ["provider", "add", "local", "--base-url", "http://127.0.0.1:11434/v1", "--no-api-key"],
    )
    assert added.exit_code == 0, added.output
    selected_provider = runner.invoke(run_cli.app, ["config", "set-provider", "local"])
    assert selected_provider.exit_code == 0, selected_provider.output
    selected_model = runner.invoke(run_cli.app, ["config", "set-model", "qwen3:32b"])
    assert selected_model.exit_code == 0, selected_model.output
    shown = runner.invoke(run_cli.app, ["config", "show"])
    assert shown.exit_code == 0, shown.output
    assert "qwen3:32b" in shown.output
    assert '"api_key":' not in shown.output
    listed = runner.invoke(run_cli.app, ["provider", "list"])
    assert listed.exit_code == 0, listed.output
    assert '"name": "local"' in listed.output
    checked = runner.invoke(run_cli.app, ["config", "check"])
    assert checked.exit_code == 0, checked.output
    removed = runner.invoke(run_cli.app, ["provider", "remove", "local"])
    assert removed.exit_code == 0, removed.output


def test_cli_status_doctor_and_restore(tmp_path: Path, monkeypatch) -> None:
    path = tmp_path / "config.toml"
    _use_config_path(monkeypatch, path)
    runner = CliRunner()
    added = runner.invoke(
        run_cli.app,
        ["provider", "add", "local", "--base-url", "http://127.0.0.1:11434/v1", "--no-api-key"],
    )
    assert added.exit_code == 0, added.output
    selected = runner.invoke(run_cli.app, ["config", "set-provider", "local"])
    assert selected.exit_code == 0, selected.output

    status = runner.invoke(run_cli.app, ["config", "status", "--json"])
    assert status.exit_code == 0, status.output
    payload = json.loads(status.output)
    assert payload["effective"]["provider"]["name"] == "local"
    assert payload["last_known_good_available"] is True

    diagnosed = runner.invoke(run_cli.app, ["config", "doctor", "--json"])
    assert diagnosed.exit_code == 0, diagnosed.output
    assert json.loads(diagnosed.output)["ok"] is True

    path.write_text('model = "external"\nmodel_provider = "hepai"\n', encoding="utf-8")
    restored = runner.invoke(run_cli.app, ["config", "restore"])
    assert restored.exit_code == 0, restored.output
    assert tomllib.loads(path.read_text(encoding="utf-8"))["model_provider"] == "local"


def test_cli_provider_setup_tests_previews_and_commits(tmp_path: Path, monkeypatch) -> None:
    path = tmp_path / "config.toml"
    _use_config_path(monkeypatch, path)

    async def probe(_draft, **_kwargs):
        assert not path.exists()
        return {"ok": True, "persisted": False}

    monkeypatch.setattr(run_cli, "probe_provider_draft", probe)
    result = CliRunner().invoke(
        run_cli.app,
        ["provider", "setup"],
        input="5\n\n\nqwen3:32b\ny\ny\n",
    )
    assert result.exit_code == 0, result.output
    parsed = tomllib.loads(path.read_text(encoding="utf-8"))
    assert parsed["model"] == "qwen3:32b"
    assert parsed["model_provider"] == "ollama"
    assert parsed["model_providers"]["ollama"]["requires_api_key"] is False
    assert "nothing saved yet" in result.output


def test_cli_provider_setup_cancel_after_preview_writes_nothing(tmp_path: Path, monkeypatch) -> None:
    path = tmp_path / "config.toml"
    _use_config_path(monkeypatch, path)
    result = CliRunner().invoke(
        run_cli.app,
        ["provider", "setup"],
        input="5\n\n\nmanual-model\nn\nn\n",
    )
    assert result.exit_code != 0
    assert not path.exists()


def test_cli_force_is_explicit_and_default_uses_revision(tmp_path: Path, monkeypatch) -> None:
    path = tmp_path / "config.toml"
    _use_config_path(monkeypatch, path)
    captured = []
    monkeypatch.setattr(run_cli, "commit_update", lambda _request, **kwargs: captured.append(kwargs.get("expected_revision")))
    runner = CliRunner()
    normal = runner.invoke(run_cli.app, ["provider", "add", "local", "--base-url", "http://127.0.0.1:1/v1", "--no-api-key"])
    forced = runner.invoke(run_cli.app, ["provider", "add", "local", "--base-url", "http://127.0.0.1:1/v1", "--no-api-key", "--force"])
    assert normal.exit_code == 0, normal.output
    assert forced.exit_code == 0, forced.output
    assert captured[0] == "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    assert captured[1] is None
