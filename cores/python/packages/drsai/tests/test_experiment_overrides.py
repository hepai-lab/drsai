from __future__ import annotations

import json
import sqlite3
from pathlib import Path

import pytest

from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
from drsai.backend.runtime.experiment_overrides import (
    OverrideValidationError,
    UnsupportedOverrideError,
    normalize_overrides,
    run_experiment_capabilities,
)
from drsai.backend.runtime.experiments import InvalidExperimentOverrides, UnsupportedExperimentOverrides


def _draft(tmp_path: Path):
    engine = RuntimeEngine(
        tmp_path / "runtime.sqlite3",
        RuntimeEngineIdentity("runtime-overrides", "instance-overrides"),
        lambda workspace_id: workspace_id == "workspace-one",
    )
    session = engine.create_session("workspace-one", "Overrides")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "override-run", "codex")
    draft, _ = engine.experiments.create(
        run["run_id"], created_by="user-one", idempotency_key="override-draft",
    )
    return engine, draft


def test_unicode_input_and_attachment_content_digests(tmp_path: Path) -> None:
    engine, draft = _draft(tmp_path)
    message = "粒子物理实验 🧪" * 10_000
    updated = engine.experiments.update(
        draft["experiment_id"], expected_version=1, idempotency_key="unicode",
        patch={"overrides": {
            "input": {"message": message},
            "attachments": [{
                "reference": "workspace://dataset/input.parquet",
                "content_digest": "a" * 64,
                "required": True,
            }],
        }},
    )
    assert updated["overrides"]["input"]["message"] == message
    assert updated["overrides"]["attachments"][0]["reference"].startswith("workspace://")
    assert updated["overrides"]["attachments"][0]["content_digest"] == "sha256:" + "a" * 64
    assert updated["safe_summary"]["input"]["characters"] == len(message)
    assert message not in json.dumps(updated["safe_summary"], ensure_ascii=False)


def test_model_allowlist_and_parameter_boundaries() -> None:
    valid = normalize_overrides({"model": {
        "provider_id": "openai", "model_id": "gpt-test",
    }})
    assert valid["model"] == {"provider_id": "openai", "model_id": "gpt-test"}
    for model in (
        {"provider_id": "openai", "model_id": "gpt-test", "temperature": 2.01},
        {"provider_id": "openai", "model_id": "gpt-test", "top_p": -0.1},
        {"provider_id": "openai", "model_id": "gpt-test", "unknown": True},
    ):
        with pytest.raises(OverrideValidationError):
            normalize_overrides({"model": model})


@pytest.mark.parametrize("field,value", [
    ("resources", [{"reference": "resource://dataset", "required": True}]),
    ("prompt", {"reference": "prompt://analysis"}),
    ("agent", {"reference": "agent://researcher"}),
    ("skills", [{"reference": "skill://pdf"}]),
    ("tools", [{"reference": "tool://shell"}]),
    ("credential_refs", ["credential://model/provider-one"]),
])
def test_executor_unsupported_overrides_fail_closed(field: str, value: object) -> None:
    with pytest.raises(UnsupportedOverrideError, match="Unsupported override fields"):
        normalize_overrides({field: value})


@pytest.mark.parametrize("field,value", [
    ("temperature", 0.5), ("top_p", 0.9), ("max_output_tokens", 100),
    ("seed", 42), ("revision_digest", "b" * 64),
])
def test_executor_unsupported_model_parameters_fail_closed(field: str, value: object) -> None:
    with pytest.raises(UnsupportedOverrideError, match="Unsupported model override fields"):
        normalize_overrides({"model": {"provider_id": "openai", "model_id": "gpt-test", field: value}})


def test_capability_contract_only_advertises_executor_supported_fields() -> None:
    capabilities = run_experiment_capabilities()
    assert capabilities["supported_override_fields"] == ["attachments", "input", "model"]
    assert capabilities["supported_model_fields"] == ["model_id", "provider_id"]
    assert capabilities["default_replay_modes"] == ["rerun_from_start"]
    assert capabilities["advanced_replay_modes"] == []


def test_reset_to_original_produces_empty_digest_and_persists_after_reopen(tmp_path: Path) -> None:
    engine, draft = _draft(tmp_path)
    changed = engine.experiments.update(
        draft["experiment_id"], expected_version=1, idempotency_key="change",
        patch={"overrides": {"input": {"message": "changed"}}},
    )
    reset = engine.experiments.update(
        draft["experiment_id"], expected_version=2, idempotency_key="reset",
        patch={"overrides": {}},
    )
    assert changed["overrides_digest"] != reset["overrides_digest"]
    assert reset["safe_summary"]["changed_fields"] == []
    reopened = RuntimeEngine(
        engine.database,
        RuntimeEngineIdentity("runtime-overrides", "instance-overrides"),
        lambda workspace_id: workspace_id == "workspace-one",
    )
    assert reopened.experiments.get(draft["experiment_id"])["overrides"] == {}


def test_credentials_are_opaque_references_and_storage_has_no_plaintext(tmp_path: Path) -> None:
    engine, draft = _draft(tmp_path)
    with pytest.raises(UnsupportedExperimentOverrides):
        engine.experiments.update(
            draft["experiment_id"], expected_version=1, idempotency_key="credential-ref",
            patch={"overrides": {"credential_refs": ["credential://model/provider-one"]}},
        )
    with sqlite3.connect(engine.database) as db:
        stored = db.execute(
            "SELECT overrides_json_encrypted FROM runtime_run_experiments WHERE experiment_id=?",
            (draft["experiment_id"],),
        ).fetchone()[0]
    assert stored.startswith("enc:v1:")
    assert "credential://model/provider-one" not in stored
    for invalid in (
        {"credential_refs": ["sk-plaintext-secret"]},
        {"model": {"provider_id": "openai", "model_id": "gpt", "api_key": "secret"}},
        {"access_token": "secret"},
    ):
        with pytest.raises((OverrideValidationError, InvalidExperimentOverrides)):
            normalize_overrides(invalid)


@pytest.mark.parametrize("secret", [
    "Bearer eyJhbGciOiJIUzI1NiJ9.payload.signature",
    "api_key=sk-phase2-secret-canary",
    "password:correct-horse-battery-staple",
    "https://user:password@example.test/private",
    "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----",
])
def test_input_override_rejects_secret_corpus(secret: str) -> None:
    with pytest.raises(OverrideValidationError, match="credential-like plaintext"):
        normalize_overrides({"input": {"message": f"Analyze this value: {secret}"}})


def test_invalid_override_update_is_atomic(tmp_path: Path) -> None:
    engine, draft = _draft(tmp_path)
    with pytest.raises(InvalidExperimentOverrides):
        engine.experiments.update(
            draft["experiment_id"], expected_version=1, idempotency_key="invalid",
            patch={"overrides": {"model": {"provider_id": "openai", "model_id": "gpt", "temperature": 3}}},
        )
    current = engine.experiments.get(draft["experiment_id"])
    assert current["draft_version"] == 1
    assert current["overrides"] == {}
