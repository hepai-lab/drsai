from __future__ import annotations

import time
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from opendrsai_regression.agent_service import AgentRegressionService, TERMINAL_STATES, _normalize_options, _safe_summary, _summary_status, _write_reference_documents

REGRESSION_ROOT = Path(__file__).resolve().parents[1]


def test_execution_options_are_closed_and_normalized() -> None:
    assert _normalize_options(None) == {"failure_policy": "continue"}
    assert _normalize_options({"failure_policy": "stop"}) == {"failure_policy": "stop"}
    with pytest.raises(ValueError, match="unknown"):
        _normalize_options({"arbitrary_shell": True})
    with pytest.raises(ValueError, match="failure_policy"):
        _normalize_options({"failure_policy": "ignore"})


def test_partial_stop_result_is_not_a_false_pass_and_names_not_run_cases() -> None:
    summary = {
        "total": 1, "attempts": 1, "passed": 1, "failed": 0, "error": 0,
        "inconclusive": 0, "results": [{"case_id": "qa.greeting.hello", "status": "passed"}],
    }
    assert _summary_status(summary, 2) == "failed"
    safe = _safe_summary(summary, "eval-test", ["qa.greeting.hello", "qa.constraints.json"])
    assert safe["requested_total"] == 2
    assert safe["not_run_case_ids"] == ["qa.constraints.json"]


def test_case_source_references_bind_to_persisted_evaluation_evidence(tmp_path: Path) -> None:
    evaluation_id = "eval-00000000-0000-4000-8000-000000000001"
    summary = {
        "total": 1, "attempts": 1, "passed": 1, "failed": 0, "error": 0, "inconclusive": 0,
        "results": [{
            "case_id": "run.inspect_compare", "case_revision": 1, "status": "passed",
            "evidence": {
                "output": "comparison complete",
                "comparison": {"comparison_id": "comparison-regression-001", "verdict": "regressed"},
                "operation_calls": [{"operation": "run.compare"}],
                "references": [{
                    "type": "run_comparison", "id": "comparison-regression-001",
                    "uri": "opendrsai://run-comparisons/comparison-regression-001", "interactive": True,
                }, {
                    "type": "run_comparison", "id": "comparison-regression-001",
                    "uri": "opendrsai://run-comparisons/comparison-regression-001", "interactive": True,
                }],
            },
        }],
    }
    safe = _safe_summary(summary, evaluation_id, ["run.inspect_compare"])
    rebound = safe["results"][0]["references"][0]
    assert len(safe["results"][0]["references"]) == 1
    assert rebound == {
        "type": "run_comparison", "id": "comparison-regression-001", "interactive": True,
        "uri": (
            f"opendrsai://regression/evaluations/{evaluation_id}/evidence/"
            "run.inspect_compare/run_comparison/comparison-regression-001"
        ),
    }

    directory = tmp_path / evaluation_id
    directory.mkdir()
    _write_reference_documents(directory, safe, summary, evaluation_id)
    document = json.loads((
        directory / "references" / "run.inspect_compare" / "run_comparison"
        / "comparison-regression-001.json"
    ).read_text(encoding="utf-8"))
    assert document["kind"] == "source_evidence"
    assert document["reference"]["id"] == "comparison-regression-001"
    assert document["evidence"]["comparison"]["verdict"] == "regressed"


def test_preflight_blocks_without_gateway_configuration(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("OPENDRSAI_REGRESSION_ALLOW_FIXTURE", raising=False)
    monkeypatch.delenv("OPENDRSAI_REGRESSION_GATEWAY_URL", raising=False)
    monkeypatch.delenv("OPENDRSAI_MODEL_CAPABILITY_SNAPSHOT", raising=False)
    service = AgentRegressionService(REGRESSION_ROOT, tmp_path)
    monkeypatch.setattr(service, "_model_snapshot", lambda: None)
    result = service.preflight("p3-desktop", ["qa.greeting.hello"])
    assert result["status"] == "blocked"
    assert result["missing"] == ["gateway_url", "model_capability_snapshot"]
    assert result["confirmation_token"] is None


def test_preflight_discovers_latest_valid_development_model_snapshot(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("OPENDRSAI_REGRESSION_ALLOW_FIXTURE", raising=False)
    monkeypatch.setenv("OPENDRSAI_REGRESSION_GATEWAY_URL", "http://127.0.0.1:18642")
    monkeypatch.delenv("OPENDRSAI_MODEL_CAPABILITY_SNAPSHOT", raising=False)
    service = AgentRegressionService(REGRESSION_ROOT, tmp_path, workspace_path=tmp_path)
    monkeypatch.setattr(service, "_workspace_id", lambda: "workspace-1")
    monkeypatch.setattr(service, "_model_provider_status", lambda: {
        "status": "ready", "provider_id": "zhizengzeng", "model_id": "deepseek-v4-flash",
    })
    result = service.preflight("p3-desktop", ["qa.greeting.hello"])
    assert result["status"] == "ready"
    assert result["model_capability_snapshot"].endswith("capability-snapshot.json")


def test_preflight_blocks_when_agent_workspace_is_not_registered(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("OPENDRSAI_REGRESSION_ALLOW_FIXTURE", raising=False)
    monkeypatch.setenv("OPENDRSAI_REGRESSION_GATEWAY_URL", "http://127.0.0.1:18642")
    service = AgentRegressionService(REGRESSION_ROOT, tmp_path, workspace_path=tmp_path / "workspace")
    monkeypatch.setattr(service, "_workspace_id", lambda: None)
    monkeypatch.setattr(service, "_model_snapshot", lambda: tmp_path / "snapshot.json")
    result = service.preflight("p3-desktop", ["qa.greeting.hello"])
    assert result["status"] == "blocked"
    assert result["missing"] == ["workspace_registration"]


def test_preflight_blocks_before_run_when_agent_provider_credential_is_unusable(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("OPENDRSAI_REGRESSION_ALLOW_FIXTURE", raising=False)
    monkeypatch.setenv("OPENDRSAI_REGRESSION_GATEWAY_URL", "http://127.0.0.1:18642")
    service = AgentRegressionService(REGRESSION_ROOT, tmp_path, workspace_path=tmp_path / "workspace")
    monkeypatch.setattr(service, "_workspace_id", lambda: "workspace-1")
    monkeypatch.setattr(service, "_model_snapshot", lambda: tmp_path / "snapshot.json")
    monkeypatch.setattr(service, "_model_provider_status", lambda: {
        "status": "blocked", "missing": "model_provider_credential",
        "provider_id": "zhizengzeng", "model_id": "deepseek-v4-flash",
    })

    result = service.preflight("p3-desktop", ["qa.greeting.hello"])

    assert result["status"] == "blocked"
    assert result["missing"] == ["model_provider_credential"]
    assert result["model_provider_status"]["provider_id"] == "zhizengzeng"


def test_preflight_blocks_when_required_agent_skill_is_not_enabled(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("OPENDRSAI_REGRESSION_ALLOW_FIXTURE", raising=False)
    monkeypatch.setenv("OPENDRSAI_REGRESSION_GATEWAY_URL", "http://127.0.0.1:18642")
    snapshot = tmp_path / "snapshot.json"
    snapshot.write_text(json.dumps({"results": [
        {"model_id": "deepseek-v4-flash", "operation": "chat", "status": "runtime_verified"},
        {"model_id": "deepseek-v4-flash", "operation": "tool_calling", "status": "runtime_verified"},
        {"model_id": "gpt-5.6-luna", "operation": "chat", "status": "runtime_verified"},
    ]}), encoding="utf-8")
    service = AgentRegressionService(REGRESSION_ROOT, tmp_path, workspace_path=tmp_path / "workspace")
    monkeypatch.setattr(service, "_workspace_id", lambda: "workspace-1")
    monkeypatch.setattr(service, "_model_snapshot", lambda: snapshot)
    monkeypatch.setattr(service, "_model_provider_status", lambda: {
        "status": "ready", "provider_id": "zhizengzeng", "model_id": "deepseek-v4-flash",
    })
    monkeypatch.setattr(service, "_agent_skill_status", lambda required: {
        "status": "blocked", "required_ids": required, "enabled_ids": [], "missing_ids": ["pptx"],
    })

    result = service.preflight("p3-desktop", ["skill.presentation"])

    assert result["status"] == "blocked"
    assert result["missing"] == ["agent_skills"]
    assert result["skill_status"]["missing_ids"] == ["pptx"]


def test_preflight_blocks_before_paid_run_when_selected_model_prerequisite_is_missing(tmp_path, monkeypatch) -> None:
    monkeypatch.delenv("OPENDRSAI_REGRESSION_ALLOW_FIXTURE", raising=False)
    monkeypatch.setenv("OPENDRSAI_REGRESSION_GATEWAY_URL", "http://127.0.0.1:18642")
    snapshot = tmp_path / "snapshot.json"
    snapshot.write_text(json.dumps({"results": [
        {"model_id": "deepseek-v4-flash", "operation": "chat", "status": "runtime_verified"},
        {"model_id": "deepseek-v4-flash", "operation": "tool_calling", "status": "runtime_verified"},
        {"model_id": "gpt-5.6-luna", "operation": "chat", "status": "runtime_verified"},
    ]}), encoding="utf-8")
    service = AgentRegressionService(REGRESSION_ROOT, tmp_path, workspace_path=tmp_path / "workspace")
    monkeypatch.setattr(service, "_workspace_id", lambda: "workspace-1")
    monkeypatch.setattr(service, "_model_snapshot", lambda: snapshot)
    monkeypatch.setattr(service, "_model_provider_status", lambda: {
        "status": "ready", "provider_id": "zhizengzeng", "model_id": "deepseek-v4-flash",
    })

    result = service.preflight("p3-desktop", ["image.output.simple"])

    assert result["status"] == "blocked"
    assert result["missing"] == ["model_prerequisites"]
    assert result["model_prerequisites"] == [
        "missing model prerequisite: gemini-3.1-flash-lite-image/image_generation",
    ]


def test_multi_case_preflight_requires_scope_bound_confirmation(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("OPENDRSAI_REGRESSION_ALLOW_FIXTURE", "1")
    service = AgentRegressionService(REGRESSION_ROOT, tmp_path)
    result = service.preflight("p3-desktop", ["qa.greeting.hello", "qa.constraints.json"])
    assert result["status"] == "ready"
    assert result["confirmation_required"] is True
    with pytest.raises(ValueError, match="confirmation"):
        service.start("p3-desktop", result["case_ids"], result["catalog_revision"], "bad-token")


@pytest.mark.parametrize("case_id", ["skill.presentation", "image.output.simple", "safety.write_approval", "tool.web.hepix"])
def test_resource_network_and_write_cases_require_confirmation(tmp_path, monkeypatch, case_id) -> None:
    monkeypatch.setenv("OPENDRSAI_REGRESSION_ALLOW_FIXTURE", "1")
    service = AgentRegressionService(REGRESSION_ROOT, tmp_path)

    result = service.preflight("p3-desktop", [case_id])

    assert result["confirmation_required"] is True
    assert result["risks"]


def test_start_is_idempotent_and_persists_terminal_fixture_result(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("OPENDRSAI_REGRESSION_ALLOW_FIXTURE", "1")
    service = AgentRegressionService(REGRESSION_ROOT, tmp_path)
    preflight = service.preflight("p3-desktop", ["qa.greeting.hello"])
    first = service.start("p3-desktop", preflight["case_ids"], preflight["catalog_revision"], preflight["confirmation_token"])
    duplicate = service.start("p3-desktop", preflight["case_ids"], preflight["catalog_revision"], preflight["confirmation_token"])
    assert duplicate["evaluation_id"] == first["evaluation_id"]
    deadline = time.monotonic() + 20
    current = first
    while time.monotonic() < deadline:
        current = service.get(first["evaluation_id"])
        if current["status"] in TERMINAL_STATES:
            break
        time.sleep(0.05)
    assert current["status"] == "passed"
    assert current["result"]["passed"] == 1
    assert current["result"]["references"][0]["uri"].startswith("opendrsai://regression/")
    reference_dir = tmp_path / first["evaluation_id"]
    summary_reference = json.loads((reference_dir / "summary.json").read_text(encoding="utf-8"))
    evidence_reference = json.loads((reference_dir / "evidence.json").read_text(encoding="utf-8"))
    assert summary_reference["kind"] == "summary"
    assert evidence_reference["kind"] == "evidence"
    assert evidence_reference["cases"][0]["run_id"]
    assert "output" not in evidence_reference["cases"][0]
    events = service.events(first["evaluation_id"])
    assert events["next_cursor"] >= 5
    assert events["events"][-1]["data"]["status"] == "passed"


def test_confirmation_token_cannot_be_reused_for_different_scope(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("OPENDRSAI_REGRESSION_ALLOW_FIXTURE", "1")
    service = AgentRegressionService(REGRESSION_ROOT, tmp_path)
    first = service.preflight("p3-desktop", ["qa.greeting.hello", "qa.constraints.json"])
    second = service.preflight("p3-desktop", ["qa.greeting.hello", "tool.web.hepix"])
    with pytest.raises(ValueError, match="scope"):
        service.start("p3-desktop", second["case_ids"], second["catalog_revision"], first["confirmation_token"])


def test_valid_confirmation_starts_exact_multi_case_scope(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("OPENDRSAI_REGRESSION_ALLOW_FIXTURE", "1")
    service = AgentRegressionService(REGRESSION_ROOT, tmp_path)
    preflight = service.preflight("p3-desktop", ["qa.greeting.hello", "qa.constraints.json"])
    evaluation = service.start("p3-desktop", preflight["case_ids"], preflight["catalog_revision"], preflight["confirmation_token"])
    assert evaluation["case_ids"] == ["qa.greeting.hello", "qa.constraints.json"]


def test_history_marks_stale_process_as_interrupted_not_passed(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("OPENDRSAI_REGRESSION_ALLOW_FIXTURE", "1")
    service = AgentRegressionService(REGRESSION_ROOT, tmp_path)
    evaluation_id = "eval-00000000-0000-4000-8000-000000000001"
    directory = tmp_path / evaluation_id
    directory.mkdir()
    (directory / "evaluation.json").write_text(json.dumps({
        "evaluation_id": evaluation_id, "suite_id": "p3-desktop", "case_ids": ["qa.greeting.hello"],
        "catalog_revision": "old", "status": "running", "created_at": "2026-01-01T00:00:00+00:00",
        "updated_at": (datetime.now(timezone.utc) - timedelta(minutes=5)).isoformat(), "idempotency_key": "stale",
        "adapter": "gateway", "result": None, "error_code": None, "error_message": None,
    }), encoding="utf-8")
    recovered = service.history()[0]
    assert recovered["status"] == "blocked"
    assert recovered["error_code"] == "regression_execution_interrupted"


def test_history_recovers_terminal_summary_after_manager_restart(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("OPENDRSAI_REGRESSION_ALLOW_FIXTURE", "1")
    service = AgentRegressionService(REGRESSION_ROOT, tmp_path)
    evaluation_id = "eval-00000000-0000-4000-8000-000000000002"
    directory = tmp_path / evaluation_id
    result_directory = directory / "run-results" / evaluation_id
    result_directory.mkdir(parents=True)
    (directory / "evaluation.json").write_text(json.dumps({
        "evaluation_id": evaluation_id, "suite_id": "p3-desktop", "case_ids": ["qa.greeting.hello"],
        "catalog_revision": "revision", "status": "running", "created_at": "2026-01-01T00:00:00+00:00",
        "updated_at": "2026-01-01T00:00:00+00:00", "idempotency_key": "recoverable",
        "adapter": "gateway", "result": None, "error_code": None, "error_message": None, "runner_pid": None,
    }), encoding="utf-8")
    (result_directory / "summary.json").write_text(json.dumps({
        "total": 1, "attempts": 1, "passed": 1, "failed": 0, "error": 0, "inconclusive": 0,
        "results": [{
            "case_id": "qa.greeting.hello", "case_revision": 1, "attempt": 1, "status": "passed",
            "run_id": "run-1", "session_id": "session-1", "duration_seconds": 1.0,
            "case_snapshot_sha256": "a" * 64, "assertions": [], "evidence": {},
        }],
    }), encoding="utf-8")

    recovered = service.history()[0]
    assert recovered["status"] == "passed"
    assert recovered["result"]["results"][0]["run_id"] == "run-1"
    assert recovered["result"]["results"][0]["case_snapshot_sha256"] == "a" * 64
    assert (directory / "summary.json").is_file()
    assert (directory / "evidence.json").is_file()
    assert service.events(evaluation_id)["events"][-1]["type"] == "evaluation_recovered"


def test_events_return_stable_one_based_cursors(tmp_path) -> None:
    service = AgentRegressionService(REGRESSION_ROOT, tmp_path)
    evaluation_id = "eval-00000000-0000-4000-8000-000000000003"
    service._event(evaluation_id, "first", {"value": 1})
    service._event(evaluation_id, "second", {"value": 2})

    initial = service.events(evaluation_id)
    resumed = service.events(evaluation_id, after_cursor=1)

    assert [event["cursor"] for event in initial["events"]] == [1, 2]
    assert resumed == {"events": [{
        **initial["events"][1], "cursor": 2,
    }], "next_cursor": 2}


def test_cancel_before_runner_start_is_terminal_and_does_not_launch_process(tmp_path, monkeypatch) -> None:
    service = AgentRegressionService(REGRESSION_ROOT, tmp_path)
    evaluation_id = "eval-00000000-0000-4000-8000-000000000004"
    service._write({
        "evaluation_id": evaluation_id, "suite_id": "p3-desktop",
        "case_ids": ["qa.greeting.hello"], "catalog_revision": "revision",
        "options": {"failure_policy": "continue"}, "status": "preparing_environment",
        "created_at": "2026-01-01T00:00:00+00:00", "updated_at": "2026-01-01T00:00:00+00:00",
        "idempotency_key": "cancel-before-start", "adapter": "gateway", "result": None,
        "error_code": None, "error_message": None,
    })
    cancelled = service.cancel(evaluation_id)
    monkeypatch.setattr("opendrsai_regression.agent_service.subprocess.Popen", lambda *_args, **_kwargs: pytest.fail("cancelled evaluation launched a Runner"))

    service._run(evaluation_id)

    assert cancelled["status"] == "cancelled"
    assert service.get(evaluation_id)["status"] == "cancelled"
    assert cancelled["result"]["not_run_case_ids"] == ["qa.greeting.hello"]


def test_cancel_preserves_partial_results_and_safe_evidence_references(tmp_path) -> None:
    service = AgentRegressionService(REGRESSION_ROOT, tmp_path)
    evaluation_id = "eval-00000000-0000-4000-8000-000000000005"
    service._write({
        "evaluation_id": evaluation_id, "suite_id": "p3-desktop",
        "case_ids": ["qa.greeting.hello", "qa.constraints.json"], "catalog_revision": "revision",
        "options": {"failure_policy": "continue"}, "status": "running",
        "created_at": "2026-01-01T00:00:00+00:00", "updated_at": "2026-01-01T00:00:00+00:00",
        "idempotency_key": "cancel-partial", "adapter": "gateway", "result": None,
        "error_code": None, "error_message": None,
    })
    result_dir = tmp_path / evaluation_id / "run-results" / evaluation_id
    result_dir.mkdir(parents=True)
    (result_dir / "results.jsonl").write_text(json.dumps({
        "case_id": "qa.greeting.hello", "case_revision": 1, "attempt": 1,
        "status": "passed", "run_id": "run-1", "session_id": "session-1",
        "duration_seconds": 1.25, "assertions": [], "case_snapshot_sha256": "a" * 64,
        "evidence": {
            "manifest": {"model": {"provider": "test", "id": "model"}},
            "tool_calls": [{"name": "read", "result": "authorization=secret-token"}],
            "side_effects": [{"kind": "none"}], "artifacts": [], "approvals": [],
        },
    }, ensure_ascii=False) + "\n", encoding="utf-8")

    cancelled = service.cancel(evaluation_id)
    evidence = json.loads((tmp_path / evaluation_id / "evidence.json").read_text(encoding="utf-8"))

    assert cancelled["status"] == "cancelled"
    assert cancelled["result"]["total"] == 1
    assert cancelled["result"]["duration_seconds"] == 1.25
    assert cancelled["result"]["not_run_case_ids"] == ["qa.constraints.json"]
    assert evidence["cases"][0]["side_effects"] == [{"kind": "none"}]
    assert "secret-token" not in json.dumps(evidence)


def test_runner_progress_is_projected_and_cancel_reaches_active_gateway_run(tmp_path, monkeypatch) -> None:
    service = AgentRegressionService(REGRESSION_ROOT, tmp_path)
    evaluation_id = "eval-00000000-0000-4000-8000-000000000006"
    directory = tmp_path / evaluation_id
    directory.mkdir()
    progress = [
        {"type": "case_session_created", "data": {"case_id": "qa.greeting.hello", "session_id": "session-1"}},
        {"type": "case_run_created", "data": {"case_id": "qa.greeting.hello", "session_id": "session-1", "run_id": "run-active"}},
        {"type": "case_run_created", "data": {"case_id": "qa.constraints.json", "session_id": "session-2", "run_id": "run-done"}},
        {"type": "case_run_terminal", "data": {"case_id": "qa.constraints.json", "session_id": "session-2", "run_id": "run-done", "status": "completed"}},
    ]
    (directory / "runner-progress.jsonl").write_text(
        "".join(json.dumps(item) + "\n" for item in progress), encoding="utf-8",
    )
    requested = []

    class Response:
        def __enter__(self): return self
        def __exit__(self, *_args): return None

    class Opener:
        def open(self, request, timeout):
            requested.append((request.full_url, timeout))
            return Response()

    monkeypatch.setenv("OPENDRSAI_REGRESSION_GATEWAY_URL", "http://127.0.0.1:18642")
    monkeypatch.setattr("opendrsai_regression.agent_service.urllib.request.build_opener", lambda *_args: Opener())

    emitted = service._emit_runner_progress(evaluation_id, directory / "runner-progress.jsonl", 0)
    cancelled = service._cancel_active_runs(evaluation_id)

    assert emitted == 4
    assert [event["type"] for event in service.events(evaluation_id)["events"]] == [item["type"] for item in progress]
    assert cancelled == ["run-active"]
    assert requested == [("http://127.0.0.1:18642/v1/runs/run-active/cancel", 5)]
