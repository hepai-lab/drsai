from __future__ import annotations

import json
import hashlib
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from opendrsai_regression import model_capability_runner
from opendrsai_regression.model_capability_runner import bind_runtime_run_evidence, evaluate_case_model_preflight, evaluate_model_capability_gate, load_profile, run_profile, verify_audio_product_runtime


REGRESSION_ROOT = Path(__file__).resolve().parents[1]


def test_p2_profile_has_five_exact_agent_model_roles() -> None:
    profile = load_profile(REGRESSION_ROOT / "model_capabilities" / "profiles" / "zhizengzeng-my-drsai-p2.yaml")
    assert profile["provider_id"] == "zhizengzeng"
    assert [(item["role"], item["model_id"]) for item in profile["models"]] == [
        ("primary_model", "deepseek-v4-flash"),
        ("image_understanding_model", "gpt-5.6-luna"),
        ("image_generation_model", "gemini-3.1-flash-lite-image"),
        ("text_to_speech_model", "tts-1"),
        ("speech_to_text_model", "whisper-1"),
    ]
    vision = next(item for item in profile["models"] if item["role"] == "image_understanding_model")
    assert vision["required_operations"] == ["chat", "tool_calling"]
    assert vision["routes"]["tool_calling"] == ["openai_responses", "openai_chat_completions"]
    assert vision["runtime_required_operations"] == ["chat"]


def test_p2_gate_fails_closed_without_runtime_evidence(tmp_path) -> None:
    profile_path = REGRESSION_ROOT / "model_capabilities" / "profiles" / "zhizengzeng-my-drsai-p2.yaml"
    profile = load_profile(profile_path)
    rows = []
    for model in profile["models"]:
        for operation in model["required_operations"]:
            rows.append({
                "model_id": model["model_id"], "operation": operation,
                "status": "verified", "assertions": [{"id": "ok", "passed": True}],
            })
    snapshot = tmp_path / "snapshot.json"
    snapshot.write_text(json.dumps({"results": rows}), encoding="utf-8")
    passed, reasons = evaluate_model_capability_gate(profile_path, snapshot)
    assert passed is False
    assert any("runtime verification missing" in reason for reason in reasons)


def test_p2_gate_rejects_stale_snapshot(tmp_path) -> None:
    profile_path = REGRESSION_ROOT / "model_capabilities" / "profiles" / "zhizengzeng-my-drsai-p2.yaml"
    profile = load_profile(profile_path)
    rows = [{
        "provider_id": profile["provider_id"], "model_id": model["model_id"], "operation": operation,
        "status": "runtime_verified", "assertions": [{"id": "ok", "passed": True}],
    } for model in profile["models"] for operation in model["required_operations"]]
    snapshot = tmp_path / "stale.json"
    snapshot.write_text(json.dumps({
        "agent_id": profile["agent_id"],
        "created_at": (datetime.now(timezone.utc) - timedelta(hours=25)).isoformat(),
        "results": rows,
    }), encoding="utf-8")
    passed, reasons = evaluate_model_capability_gate(profile_path, snapshot)
    assert not passed and any("stale" in reason for reason in reasons)


def test_case_preflight_maps_image_input_to_bound_vision_model(tmp_path) -> None:
    class Case:
        data = {"environment": {"required_capabilities": ["image_input"]}}
    snapshot = tmp_path / "snapshot.json"
    snapshot.write_text(json.dumps({"results": [
        {"model_id": "deepseek-v4-flash", "operation": "chat", "status": "runtime_verified"},
        {"model_id": "deepseek-v4-flash", "operation": "tool_calling", "status": "runtime_verified"},
        {"model_id": "gpt-5.6-luna", "operation": "chat", "status": "verified"},
    ]}), encoding="utf-8")
    passed, reasons = evaluate_case_model_preflight([Case()], snapshot)
    assert not passed
    assert reasons == ["model prerequisite not runtime verified: gpt-5.6-luna/chat status=verified"]


def test_case_preflight_uses_agent_role_models_and_rejects_policy_revision_drift(tmp_path) -> None:
    class Case:
        data = {
            "environment": {"required_capabilities": ["image_input", "image_generation"]},
            "expect": {"image": {"visual_requirements": ["visible"]}},
        }
    rows = [
        {"model_id": "agent-primary", "operation": operation, "status": "runtime_verified", "revisions": {"agent_policy": "old"}}
        for operation in ("chat", "tool_calling")
    ] + [
        {"model_id": "vision-current", "operation": "chat", "status": "runtime_verified", "revisions": {"agent_policy": "old"}},
        {"model_id": "image-current", "operation": "image_generation", "status": "runtime_verified", "revisions": {"agent_policy": "old"}},
    ]
    snapshot = tmp_path / "snapshot.json"
    snapshot.write_text(json.dumps({"results": rows}), encoding="utf-8")

    passed, reasons = evaluate_case_model_preflight(
        [Case()], snapshot, base_model_id="agent-primary",
        role_models={"image_understanding": "vision-current", "image_generation": "image-current"},
        expected_agent_policy_revision="new",
    )

    assert passed is False
    assert reasons == [
        "model prerequisite policy revision changed: agent-primary/chat",
        "model prerequisite policy revision changed: agent-primary/tool_calling",
        "model prerequisite policy revision changed: image-current/image_generation",
        "model prerequisite policy revision changed: vision-current/chat",
    ]


def test_case_preflight_rejects_snapshot_for_a_different_agent(tmp_path) -> None:
    snapshot = tmp_path / "snapshot.json"
    snapshot.write_text(json.dumps({"agent_id": "my-drsai", "results": []}), encoding="utf-8")

    passed, reasons = evaluate_case_model_preflight(
        [], snapshot, expected_agent_id="opendrsai",
    )

    assert passed is False
    assert reasons == ["capability snapshot agent changed: expected opendrsai, got my-drsai"]


def test_profile_runner_writes_atomic_machine_markdown_and_junit_reports(tmp_path, monkeypatch) -> None:
    profile_path = REGRESSION_ROOT / "model_capabilities" / "profiles" / "zhizengzeng-my-drsai-p2.yaml"
    operations = iter(
        (model["model_id"], operation)
        for model in load_profile(profile_path)["models"]
        for operation in model["required_operations"]
    )

    def request(*_args, **_kwargs):
        model_id, operation = next(operations)
        return {"result": {
            "probe_id": f"probe-{model_id}-{operation}", "agent_id": "my-drsai",
            "provider_id": "zhizengzeng", "model_id": model_id, "operation": operation,
            "protocol": "openai_responses", "status": "verified", "duration_ms": 1,
            "evidence_kind": "real_provider", "assertions": [{"id": "ok", "passed": True}],
        }}

    monkeypatch.setattr(model_capability_runner, "_request", request)
    target = run_profile(profile_path, gateway_url="http://127.0.0.1:28642", gateway_token="secret", output_root=tmp_path)
    assert {item.name for item in target.iterdir()} == {
        "capability-snapshot.json", "results.jsonl", "report.md", "junit.xml",
    }
    assert "secret" not in "".join(item.read_text(encoding="utf-8") for item in target.iterdir())
    assert not list(target.glob("*.tmp"))


def test_p2_gate_accepts_only_complete_fresh_real_runtime_evidence(tmp_path) -> None:
    profile_path = REGRESSION_ROOT / "model_capabilities" / "profiles" / "zhizengzeng-my-drsai-p2.yaml"
    profile = load_profile(profile_path)
    revisions = {
        "provider_config": "sha256:provider", "agent_policy": "sha256:agent",
        "model_catalog": "sha256:catalog", "route_rules": "routes/1", "probe_definition": "probes/1",
    }
    rows = [{
        "provider_id": profile["provider_id"], "model_id": model["model_id"], "operation": operation,
        "status": "runtime_verified", "evidence_kind": "real_provider",
        "assertions": [{"id": "ok", "passed": True}], "revisions": revisions,
        "runtime_evidence": {"run_id": f"run-{model['model_id']}-{operation}", "manifest_digest": "sha256:manifest"},
    } for model in profile["models"] for operation in model["required_operations"]]
    snapshot_data = {
        "schema_version": "opendrsai.model-capability-snapshot/1", "agent_id": profile["agent_id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "revisions": {"profile": "sha256:" + hashlib.sha256(profile_path.read_bytes()).hexdigest()}, "results": rows,
    }
    canonical = model_capability_runner._stable_snapshot_payload(snapshot_data)
    snapshot_data["digest"] = "sha256:" + hashlib.sha256(json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    snapshot = tmp_path / "passing.json"
    snapshot.write_text(json.dumps(snapshot_data), encoding="utf-8")
    passed, reasons = evaluate_model_capability_gate(profile_path, snapshot)
    assert passed, reasons


def test_bind_runtime_run_evidence_validates_and_rehashes_snapshot(tmp_path, monkeypatch) -> None:
    profile_path = REGRESSION_ROOT / "model_capabilities" / "profiles" / "zhizengzeng-my-drsai-p2.yaml"
    snapshot_data = {
        "schema_version": "opendrsai.model-capability-snapshot/1", "agent_id": "my-drsai",
        "created_at": datetime.now(timezone.utc).isoformat(), "revisions": {"profile": "sha256:profile"},
        "results": [{
            "provider_id": "zhizengzeng", "model_id": "deepseek-v4-flash", "operation": "tool_calling",
            "status": "verified", "assertions": [{"id": "ok", "passed": True}],
        }],
    }
    snapshot_data["digest"] = "sha256:" + hashlib.sha256(json.dumps(
        model_capability_runner._stable_snapshot_payload(snapshot_data), sort_keys=True, separators=(",", ":"),
    ).encode()).hexdigest()
    snapshot = tmp_path / "snapshot.json"
    snapshot.write_text(json.dumps(snapshot_data), encoding="utf-8")
    responses = iter([
        {"run_id": "run-real", "status": "completed"},
        {"safe_manifest_digest": "abc", "manifest": {
            "model": {"id": "deepseek-v4-flash", "provider": "zhizengzeng", "operations": ["tool_calling"]},
            "outcome": {"status": "completed"},
        }},
    ])
    monkeypatch.setattr(model_capability_runner, "_get", lambda *_args, **_kwargs: next(responses))
    row = bind_runtime_run_evidence(
        profile_path, snapshot, model_id="deepseek-v4-flash", operation="tool_calling",
        run_id="run-real", gateway_url="http://gateway", gateway_token="secret",
    )
    saved = json.loads(snapshot.read_text(encoding="utf-8"))
    assert row["status"] == "runtime_verified"
    assert row["runtime_evidence"] == {"run_id": "run-real", "manifest_digest": "sha256:abc"}
    assert saved["digest"] != snapshot_data["digest"]
    assert "secret" not in snapshot.read_text(encoding="utf-8")


def test_bind_runtime_run_evidence_rejects_model_mismatch_without_writing(tmp_path, monkeypatch) -> None:
    profile_path = REGRESSION_ROOT / "model_capabilities" / "profiles" / "zhizengzeng-my-drsai-p2.yaml"
    data = {
        "schema_version": "opendrsai.model-capability-snapshot/1", "agent_id": "my-drsai",
        "created_at": datetime.now(timezone.utc).isoformat(), "revisions": {},
        "results": [{"provider_id": "zhizengzeng", "model_id": "deepseek-v4-flash",
                     "operation": "chat", "status": "verified", "assertions": [{"passed": True}]}],
    }
    data["digest"] = "sha256:" + hashlib.sha256(json.dumps(
        model_capability_runner._stable_snapshot_payload(data), sort_keys=True, separators=(",", ":"),
    ).encode()).hexdigest()
    snapshot = tmp_path / "snapshot.json"
    snapshot.write_text(json.dumps(data), encoding="utf-8")
    before = snapshot.read_bytes()
    responses = iter([
        {"status": "completed"},
        {"safe_manifest_digest": "abc", "manifest": {
            "model": {"id": "another-model", "provider": "zhizengzeng", "operations": ["chat"]},
            "outcome": {"status": "completed"},
        }},
    ])
    monkeypatch.setattr(model_capability_runner, "_get", lambda *_args, **_kwargs: next(responses))
    with pytest.raises(model_capability_runner.ModelCapabilityError, match="does not match"):
        bind_runtime_run_evidence(
            profile_path, snapshot, model_id="deepseek-v4-flash", operation="chat",
            run_id="run-wrong", gateway_url="http://gateway", gateway_token=None,
        )
    assert snapshot.read_bytes() == before


def test_bind_runtime_run_evidence_accepts_exact_image_tool_result(tmp_path, monkeypatch) -> None:
    profile_path = REGRESSION_ROOT / "model_capabilities" / "profiles" / "zhizengzeng-my-drsai-p2.yaml"
    data = {
        "schema_version": "opendrsai.model-capability-snapshot/1", "agent_id": "my-drsai",
        "created_at": datetime.now(timezone.utc).isoformat(), "revisions": {},
        "results": [{"provider_id": "zhizengzeng", "model_id": "gemini-3.1-flash-lite-image",
                     "operation": "image_generation", "status": "verified", "assertions": [{"passed": True}]}],
    }
    data["digest"] = "sha256:" + hashlib.sha256(json.dumps(
        model_capability_runner._stable_snapshot_payload(data), sort_keys=True, separators=(",", ":"),
    ).encode()).hexdigest()
    snapshot = tmp_path / "snapshot.json"
    snapshot.write_text(json.dumps(data), encoding="utf-8")
    tool_result = {"content": repr({
        "operation": "image_generation",
        "model_ref": {"provider_id": "zhizengzeng", "model_id": "gemini-3.1-flash-lite-image"},
    })}
    responses = iter([
        {"status": "completed"},
        {"safe_manifest_digest": "image-digest", "manifest": {
            "model": {"id": "deepseek-v4-flash", "provider": "zhizengzeng", "operations": ["chat"]},
            "outcome": {"status": "completed"},
        }},
        {"data": [
            {"type": "artifact.created", "data": {"artifact_id": "artifact-1"}},
            {"type": "tool.completed", "data": {"name": "image_generation", "is_error": False,
                                                   "result": json.dumps(tool_result)}},
        ]},
    ])
    monkeypatch.setattr(model_capability_runner, "_get", lambda *_args, **_kwargs: next(responses))
    row = bind_runtime_run_evidence(
        profile_path, snapshot, model_id="gemini-3.1-flash-lite-image", operation="image_generation",
        run_id="run-image", gateway_url="http://gateway", gateway_token=None,
    )
    assert row["status"] == "runtime_verified"


def test_bind_runtime_run_evidence_accepts_exact_image_understanding_manifest(tmp_path, monkeypatch) -> None:
    profile_path = REGRESSION_ROOT / "model_capabilities" / "profiles" / "zhizengzeng-my-drsai-p2.yaml"
    data = {
        "schema_version": "opendrsai.model-capability-snapshot/1", "agent_id": "my-drsai",
        "created_at": datetime.now(timezone.utc).isoformat(), "revisions": {},
        "results": [{"provider_id": "zhizengzeng", "model_id": "gpt-5.6-luna",
                     "operation": "chat", "protocol": "openai_responses", "status": "verified",
                     "assertions": [{"passed": True}]}],
    }
    data["digest"] = "sha256:" + hashlib.sha256(json.dumps(
        model_capability_runner._stable_snapshot_payload(data), sort_keys=True, separators=(",", ":"),
    ).encode()).hexdigest()
    snapshot = tmp_path / "snapshot.json"
    snapshot.write_text(json.dumps(data), encoding="utf-8")
    responses = iter([
        {"status": "completed"},
        {"safe_manifest_digest": "vision-digest", "manifest": {
            "model": {"id": "deepseek-v4-flash", "provider": "zhizengzeng", "operations": ["chat"]},
            "image_understanding": {
                "model_ref": {"provider_id": "zhizengzeng", "model_id": "gpt-5.6-luna"},
                "upstream_model_id": "gpt-5.6-luna", "operation": "image_understanding",
                "protocols": ["openai_responses"], "resource_count": 1,
            },
            "outcome": {"status": "completed"},
        }},
    ])
    monkeypatch.setattr(model_capability_runner, "_get", lambda *_args, **_kwargs: next(responses))
    row = bind_runtime_run_evidence(
        profile_path, snapshot, model_id="gpt-5.6-luna", operation="chat",
        run_id="run-vision", gateway_url="http://gateway", gateway_token=None,
    )
    assert row["status"] == "runtime_verified"
    assert row["runtime_evidence"]["manifest_digest"] == "sha256:vision-digest"


def test_p2_gate_allows_probe_only_operation_when_runtime_not_required(tmp_path) -> None:
    profile_path = REGRESSION_ROOT / "model_capabilities" / "profiles" / "zhizengzeng-my-drsai-p2.yaml"
    profile = load_profile(profile_path)
    revisions = {
        "provider_config": "sha256:provider", "agent_policy": "sha256:agent",
        "model_catalog": "sha256:catalog", "route_rules": "routes/1", "probe_definition": "probes/1",
    }
    rows = []
    for model in profile["models"]:
        runtime_required = set(model.get("runtime_required_operations", model["required_operations"]))
        for operation in model["required_operations"]:
            runtime = operation in runtime_required
            rows.append({
                "provider_id": profile["provider_id"], "model_id": model["model_id"], "operation": operation,
                "status": "runtime_verified" if runtime else "verified", "evidence_kind": "real_provider",
                "assertions": [{"id": "ok", "passed": True}], "revisions": revisions,
                "runtime_evidence": ({"run_id": "run", "manifest_digest": "sha256:manifest"} if runtime else None),
            })
    data = {
        "schema_version": "opendrsai.model-capability-snapshot/1", "agent_id": profile["agent_id"],
        "created_at": datetime.now(timezone.utc).isoformat(),
        "revisions": {"profile": "sha256:" + hashlib.sha256(profile_path.read_bytes()).hexdigest()}, "results": rows,
    }
    data["digest"] = "sha256:" + hashlib.sha256(json.dumps(
        model_capability_runner._stable_snapshot_payload(data), sort_keys=True, separators=(",", ":"),
    ).encode()).hexdigest()
    snapshot = tmp_path / "snapshot.json"
    snapshot.write_text(json.dumps(data), encoding="utf-8")
    passed, reasons = evaluate_model_capability_gate(profile_path, snapshot)
    assert passed, reasons


def test_verify_audio_product_runtime_binds_both_operations_without_media(tmp_path, monkeypatch) -> None:
    profile_path = REGRESSION_ROOT / "model_capabilities" / "profiles" / "zhizengzeng-my-drsai-p2.yaml"
    data = {
        "schema_version": "opendrsai.model-capability-snapshot/1", "agent_id": "my-drsai",
        "created_at": datetime.now(timezone.utc).isoformat(), "revisions": {},
        "results": [
            {"provider_id": "zhizengzeng", "model_id": "tts-1", "operation": "text_to_speech",
             "status": "verified", "assertions": [{"passed": True}]},
            {"provider_id": "zhizengzeng", "model_id": "whisper-1", "operation": "speech_to_text",
             "status": "verified", "assertions": [{"passed": True}]},
        ],
    }
    data["digest"] = "sha256:" + hashlib.sha256(json.dumps(
        model_capability_runner._stable_snapshot_payload(data), sort_keys=True, separators=(",", ":"),
    ).encode()).hexdigest()
    snapshot = tmp_path / "snapshot.json"
    snapshot.write_text(json.dumps(data), encoding="utf-8")
    monkeypatch.setattr(model_capability_runner, "_audio_product_roundtrip", lambda *_args: {
        "speech": {"model_id": "tts-1", "operation_id": "speech-op", "evidence_digest": "sha256:speech"},
        "transcription": {"model_id": "whisper-1", "operation_id": "stt-op", "evidence_digest": "sha256:stt"},
    })
    speech, transcription = verify_audio_product_runtime(
        profile_path, snapshot, gateway_url="http://gateway", gateway_token="secret",
    )
    assert speech["status"] == transcription["status"] == "runtime_verified"
    saved = snapshot.read_text(encoding="utf-8")
    assert "speech-op" in saved and "stt-op" in saved
    assert "secret" not in saved and "audio/" not in saved
