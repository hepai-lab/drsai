from __future__ import annotations

import concurrent.futures
import multiprocessing
import tomllib

import pytest

from drsai.config import (
    ConfigConflict,
    ConfigError,
    ConfigUpdateRequest,
    commit_update,
    config_revision,
    preview_update,
    last_known_good_path,
    restore_last_known_good,
)
from drsai.config import service as service_module


def _process_commit(path_text: str, revision: str, model: str, start, results) -> None:
    from drsai.config import ConfigConflict, ConfigUpdateRequest, commit_update
    start.wait(10)
    try:
        commit_update(
            ConfigUpdateRequest(model=model, model_provider="hepai"),
            path=path_text,
            environ={},
            expected_revision=revision,
        )
        results.put("committed")
    except ConfigConflict:
        results.put("conflict")


def test_preview_validates_without_writing(tmp_path) -> None:
    path = tmp_path / "config.toml"
    path.write_text('# preserved\nmodel = "old"\nmodel_provider = "hepai"\n', encoding="utf-8")
    before = path.read_bytes()

    preview = preview_update(
        ConfigUpdateRequest(
            model="custom-model",
            model_provider="custom",
            provider_name="custom",
            provider_values={
                "base_url": "https://provider.example/v1",
                "requires_api_key": False,
            },
        ),
        path=path,
        environ={},
    )

    assert preview.resolved.model == "custom-model"
    assert preview.resolved.provider.name == "custom"
    assert path.read_bytes() == before
    assert not path.with_suffix(".toml.bak").exists()


def test_invalid_candidate_never_changes_disk(tmp_path) -> None:
    path = tmp_path / "config.toml"
    path.write_text('model = "old"\nmodel_provider = "hepai"\n', encoding="utf-8")
    before = path.read_bytes()

    with pytest.raises(ConfigError, match="absolute http"):
        commit_update(
            ConfigUpdateRequest(
                provider_name="broken",
                provider_values={"base_url": "not-a-url", "requires_api_key": False},
                model="model",
                model_provider="broken",
            ),
            path=path,
            environ={},
        )

    assert path.read_bytes() == before


def test_commit_is_atomic_and_revisioned(tmp_path) -> None:
    path = tmp_path / "config.toml"
    path.write_text('[desktop]\ntheme = "dark"\n', encoding="utf-8")
    expected = config_revision(path)

    result = commit_update(
        ConfigUpdateRequest(
            provider_name="local",
            provider_values={
                "base_url": "http://127.0.0.1:11434/v1",
                "requires_api_key": False,
            },
            model="qwen3:32b",
            model_provider="local",
        ),
        path=path,
        environ={},
        expected_revision=expected,
    )

    parsed = tomllib.loads(path.read_text(encoding="utf-8"))
    assert parsed["desktop"]["theme"] == "dark"
    assert parsed["model"] == "qwen3:32b"
    assert parsed["model_providers"]["local"]["requires_api_key"] is False
    assert result.previous_revision == expected
    assert result.revision == config_revision(path)
    assert result.revision != expected
    assert last_known_good_path(path).read_bytes() == path.read_bytes()


def test_restore_last_known_good_validates_revision_and_restores(tmp_path) -> None:
    path = tmp_path / "config.toml"
    path.write_text('model = "first"\nmodel_provider = "hepai"\n', encoding="utf-8")
    committed = commit_update(
        ConfigUpdateRequest(model="known-good", model_provider="hepai"),
        path=path,
        environ={},
    )
    path.write_text('model = "externally-changed"\nmodel_provider = "hepai"\n', encoding="utf-8")

    with pytest.raises(ConfigConflict):
        restore_last_known_good(path=path, environ={}, expected_revision=committed.revision)

    current_revision = config_revision(path)
    result = restore_last_known_good(path=path, environ={}, expected_revision=current_revision)
    assert result.resolved.model == "known-good"
    assert tomllib.loads(path.read_text(encoding="utf-8"))["model"] == "known-good"


def test_restore_requires_snapshot(tmp_path) -> None:
    with pytest.raises(ConfigError, match="No last-known-good"):
        restore_last_known_good(path=tmp_path / "config.toml", environ={})


def test_stale_revision_returns_conflict_without_writing(tmp_path) -> None:
    path = tmp_path / "config.toml"
    path.write_text('model = "first"\nmodel_provider = "hepai"\n', encoding="utf-8")
    stale = config_revision(path)
    path.write_text('model = "second"\nmodel_provider = "hepai"\n', encoding="utf-8")
    before = path.read_bytes()

    with pytest.raises(ConfigConflict):
        commit_update(
            ConfigUpdateRequest(model="third", model_provider="hepai"),
            path=path,
            environ={},
            expected_revision=stale,
        )

    assert path.read_bytes() == before


def test_concurrent_expected_revision_has_one_winner(tmp_path) -> None:
    path = tmp_path / "config.toml"
    path.write_text('model = "initial"\nmodel_provider = "hepai"\n', encoding="utf-8")
    revision = config_revision(path)

    def update(model: str) -> str:
        try:
            commit_update(
                ConfigUpdateRequest(model=model, model_provider="hepai"),
                path=path,
                environ={},
                expected_revision=revision,
            )
            return "committed"
        except ConfigConflict:
            return "conflict"

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        outcomes = list(pool.map(update, ["one", "two"]))

    assert sorted(outcomes) == ["committed", "conflict"]
    assert tomllib.loads(path.read_text(encoding="utf-8"))["model"] in {"one", "two"}


def test_cross_process_expected_revision_has_one_winner(tmp_path) -> None:
    path = tmp_path / "config.toml"
    path.write_text('model = "initial"\nmodel_provider = "hepai"\n', encoding="utf-8")
    revision = config_revision(path)
    context = multiprocessing.get_context("spawn")
    start = context.Event()
    results = context.Queue()
    processes = [
        context.Process(target=_process_commit, args=(str(path), revision, model, start, results))
        for model in ("process-one", "process-two")
    ]
    for process in processes:
        process.start()
    start.set()
    outcomes = [results.get(timeout=20) for _ in processes]
    for process in processes:
        process.join(timeout=20)
        assert process.exitcode == 0
    assert sorted(outcomes) == ["committed", "conflict"]
    assert tomllib.loads(path.read_text(encoding="utf-8"))["model"] in {"process-one", "process-two"}


def test_credential_is_committed_then_old_reference_is_cleaned(tmp_path, monkeypatch) -> None:
    old = "drsai-credential:00000000-0000-0000-0000-000000000001"
    new = "drsai-credential:00000000-0000-0000-0000-000000000002"
    path = tmp_path / "config.toml"
    path.write_text(
        'model = "custom"\nmodel_provider = "custom"\n'
        '[model_providers.custom]\nbase_url = "https://old.example/v1"\n'
        f'api_key_credential = "{old}"\n',
        encoding="utf-8",
    )
    deleted = []
    monkeypatch.setattr(service_module, "store_credential", lambda _secret: new)
    monkeypatch.setattr(service_module, "delete_credential", lambda ref: deleted.append(ref) or True)

    result = commit_update(
        ConfigUpdateRequest(
            provider_name="custom",
            provider_values={"base_url": "https://new.example/v1"},
            provider_secret="new-secret",
        ),
        path=path,
        environ={},
    )

    parsed = tomllib.loads(path.read_text(encoding="utf-8"))
    assert parsed["model_providers"]["custom"]["api_key_credential"] == new
    assert deleted == [old]
    assert result.warnings == ()


def test_new_credential_is_rolled_back_when_candidate_is_invalid(tmp_path, monkeypatch) -> None:
    new = "drsai-credential:00000000-0000-0000-0000-000000000002"
    path = tmp_path / "config.toml"
    path.write_text('model = "old"\nmodel_provider = "hepai"\n', encoding="utf-8")
    before = path.read_bytes()
    deleted = []
    monkeypatch.setattr(service_module, "store_credential", lambda _secret: new)
    monkeypatch.setattr(service_module, "delete_credential", lambda ref: deleted.append(ref) or True)

    with pytest.raises(ConfigError, match="absolute http"):
        commit_update(
            ConfigUpdateRequest(
                provider_name="broken",
                provider_values={"base_url": "not-a-url"},
                provider_secret="new-secret",
            ),
            path=path,
            environ={},
        )

    assert path.read_bytes() == before
    assert deleted == [new]


def test_delete_provider_can_explicitly_retain_secure_credential(tmp_path, monkeypatch) -> None:
    reference = "drsai-credential:00000000-0000-0000-0000-000000000001"
    path = tmp_path / "config.toml"
    path.write_text(
        'model = "custom"\nmodel_provider = "custom"\n[model_providers.custom]\n'
        f'base_url = "https://example.test/v1"\napi_key_credential = "{reference}"\n',
        encoding="utf-8",
    )
    deleted = []
    monkeypatch.setattr(service_module, "delete_credential", lambda value: deleted.append(value) or True)
    commit_update(
        ConfigUpdateRequest(
            delete_provider_name="custom",
            delete_provider_credential=False,
            model="deepseek-v4-pro",
            model_provider="hepai",
        ),
        path=path,
        environ={},
    )
    assert deleted == []
