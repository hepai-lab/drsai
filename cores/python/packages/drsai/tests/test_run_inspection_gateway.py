from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import sqlite3
import subprocess
import time
from pathlib import Path
from types import SimpleNamespace

from starlette.datastructures import Headers
from drsai.backend.runtime.run_inspection import digest_manifest
from drsai.backend.runtime.agent import RuntimeRunContext


class _Request:
    headers = Headers({})
    state = SimpleNamespace(correlation_id="correlation-inspection")


def test_workspace_inspect_tool_returns_bounded_metadata_and_mutable_read_policy(tmp_path: Path) -> None:
    from drsai.backend import gateway

    (tmp_path / "visible.txt").write_text("secret content must not be returned", encoding="utf-8")
    context = RuntimeRunContext(
        runtime_id="runtime-one", instance_id="instance-one",
        workspace_id="workspace-one", workspace_path=tmp_path,
        session_id="session-one", run_id="run-one",
        agent_definition_id="agent-one", agent_definition_version="1",
        permissions=frozenset({"tool:workspace.inspect"}),
    )
    result = gateway._inspect_runtime_workspace(context, {})
    assert result["entry_count"] == 1
    assert result["entry_count_truncated"] is False
    assert result["_replay_policy"] == {
        "classification": "read_only_mutable",
        "tool_reference": "tool://workspace.inspect",
    }
    assert "visible.txt" not in str(result)
    assert "secret content" not in str(result)


def _encode(value) -> str:
    return base64.urlsafe_b64encode(json.dumps(value, separators=(",", ":")).encode()).decode().rstrip("=")


def _jwt(subject: str, secret: str) -> str:
    header = _encode({"alg": "HS256", "typ": "JWT"})
    payload = _encode({
        "sub": subject,
        "iss": "https://ai-dev.ihep.ac.cn/api",
        "aud": "hai-api",
        "org_id": "org-inspection",
        "sid": f"oidc-{subject}",
        "typ": "access_token",
        "scope": "hai_api",
        "exp": int(time.time()) + 600,
    })
    signature = base64.urlsafe_b64encode(
        hmac.new(secret.encode(), f"{header}.{payload}".encode(), hashlib.sha256).digest()
    ).decode().rstrip("=")
    return f"{header}.{payload}.{signature}"


class _AuthorizedRequest:
    def __init__(self, subject: str, secret: str, *, include_tool: bool = True, extra_headers: dict[str, str] | None = None):
        values = {
            "authorization": f"Bearer {_jwt(subject, secret)}",
            "x-opendrsai-principal": subject,
            "x-opendrsai-session-id": f"session-{subject}",
            "x-opendrsai-run-id": f"run-{subject}",
        }
        if include_tool:
            values["x-opendrsai-tool-id"] = f"tool-{subject}"
        values.update(extra_headers or {})
        self.headers = Headers(values)
        self.state = SimpleNamespace(correlation_id=f"correlation-{subject}")


def _runtime(tmp_path: Path, monkeypatch):
    home = tmp_path / "home"
    workspace = tmp_path / "workspace"
    workspace.mkdir()
    monkeypatch.setenv("DRSAI_HOME", str(home))

    from drsai.backend import gateway

    gateway._runtime_registry_instance = None
    gateway._runtime_engine_instance = None
    gateway._runtime_security_instance = None
    opened = gateway._runtime_registry().open_workspace(str(workspace))
    engine = gateway._runtime_engine()
    session = engine.create_session(opened.workspace_id, "Inspection API")
    run, _ = engine.create_run(session["session_id"], "agent@v1", "inspection-api", "codex")
    engine.set_run_input(run["run_id"], "safe input", model="gpt-test")
    return gateway, engine, session, run


def test_run_list_inspection_manifest_and_export_contract(tmp_path: Path, monkeypatch) -> None:
    gateway, engine, session, run = _runtime(tmp_path, monkeypatch)
    engine.append_event(run["run_id"], "agent.message.delta", {"delta": "hello"})
    engine.append_event(run["run_id"], "agent.completed", {"content": "hello"})
    with engine._connect() as db:
        raw_before = [tuple(row) for row in db.execute(
            "SELECT event_id,run_id,sequence,event_type,data_json,created_at FROM runtime_events ORDER BY event_id"
        ).fetchall()]
        journal_before = [tuple(row) for row in db.execute(
            "SELECT event_id,session_sequence,event_kind,payload_json FROM runtime_session_journal ORDER BY event_id"
        ).fetchall()]

    listing = asyncio.run(gateway.runtime_run_list(session["session_id"], _Request(), None, 100, None))
    assert listing["schema_version"] == "opendrsai.run-inspection/1"
    assert listing["data"][0]["run_id"] == run["run_id"]

    inspection = asyncio.run(
        gateway.runtime_run_inspection(run["run_id"], _Request(), None, 100, None, None)
    )
    assert inspection["run"]["run_id"] == run["run_id"]
    assert inspection["timeline"]
    focused_item = inspection["timeline"][-1]
    locator = asyncio.run(gateway.runtime_run_item_locator(
        run["run_id"], focused_item["id"], _Request(), None, None,
    ))
    assert locator["run_id"] == run["run_id"]
    assert locator["item_id"] == focused_item["id"]
    located = asyncio.run(gateway.runtime_run_inspection(
        run["run_id"], _Request(), locator["timeline_cursor"], 1, None, None,
    ))
    assert located["timeline"][0]["id"] == focused_item["id"]

    manifest = asyncio.run(gateway.runtime_run_manifest(run["run_id"], _Request()))
    assert manifest["manifest_digest"] == inspection["manifest"]["manifest_digest"]
    exported = asyncio.run(gateway.runtime_run_manifest_export(run["run_id"], _Request()))
    assert "attachment" in exported.headers["content-disposition"]
    assert exported.headers["cache-control"] == "no-store"
    payload = json.loads(exported.body)
    assert payload["run_id"] == manifest["run_id"]
    assert payload["exported_at"]
    assert payload["privacy_notice"]
    assert payload["integrity"] == {
        "algorithm": "sha256",
        "digest_scope": "safe_manifest",
        "digest": payload["safe_manifest_digest"],
    }
    assert payload["safe_manifest_digest"] == digest_manifest(payload["manifest"])
    with engine._connect() as db:
        raw_after = [tuple(row) for row in db.execute(
            "SELECT event_id,run_id,sequence,event_type,data_json,created_at FROM runtime_events ORDER BY event_id"
        ).fetchall()]
        journal_after = [tuple(row) for row in db.execute(
            "SELECT event_id,session_sequence,event_kind,payload_json FROM runtime_session_journal ORDER BY event_id"
        ).fetchall()]
    assert raw_after == raw_before
    assert journal_after == journal_before


def test_gateway_inspection_rejects_bad_cursor_and_filter(tmp_path: Path, monkeypatch) -> None:
    gateway, _, session, run = _runtime(tmp_path, monkeypatch)
    try:
        asyncio.run(gateway.runtime_run_list(session["session_id"], _Request(), "bad!", 100, None))
    except gateway.HTTPException as exc:
        assert exc.status_code == 400
    else:
        raise AssertionError("invalid cursor should fail")

    try:
        asyncio.run(gateway.runtime_run_list(session["session_id"], _Request(), None, 100, "unknown"))
    except gateway.HTTPException as exc:
        assert exc.status_code == 400
    else:
        raise AssertionError("invalid status should fail")

    try:
        asyncio.run(gateway.runtime_run_inspection(run["run_id"], _Request(), "bad!", 100, None, None))
    except gateway.HTTPException as exc:
        assert exc.status_code == 400
    else:
        raise AssertionError("invalid timeline cursor should fail")

    for item_type, item_status in (("unknown", None), (None, "unknown")):
        try:
            asyncio.run(gateway.runtime_run_inspection(
                run["run_id"], _Request(), None, 100, item_type, item_status,
            ))
        except gateway.HTTPException as exc:
            assert exc.status_code == 400
        else:
            raise AssertionError("invalid timeline filter should fail")


def test_gateway_inspection_database_failure_has_stable_retryable_semantics(
    tmp_path: Path, monkeypatch,
) -> None:
    gateway, engine, _, run = _runtime(tmp_path, monkeypatch)
    monkeypatch.setattr(
        engine, "inspect_run",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(sqlite3.DatabaseError("private database detail")),
    )
    try:
        asyncio.run(gateway.runtime_run_inspection(run["run_id"], _Request(), None, 100, None, None))
    except gateway.HTTPException as exc:
        assert exc.status_code == 503
        assert exc.detail == {
            "code": "run_inspection_unavailable",
            "message": "Run inspection is temporarily unavailable",
            "retryable": True,
        }
        assert "private database detail" not in json.dumps(exc.detail)
    else:
        raise AssertionError("database failure should be mapped to a stable 503")


def test_inspection_authorization_role_matrix_and_audit(tmp_path: Path, monkeypatch) -> None:
    secret = "inspection-signing-secret"
    monkeypatch.setenv("OPENDRSAI_OIDC_HS256_SECRET", secret)
    monkeypatch.setenv("OPENDRSAI_ENFORCE_WORKSPACE_PERMISSIONS", "1")
    gateway, _, session, run = _runtime(tmp_path, monkeypatch)
    permissions = gateway._runtime_security().permissions
    subjects = {
        "owner": "00000000-0000-0000-0000-000000000001",
        "editor": "00000000-0000-0000-0000-000000000002",
        "viewer": "00000000-0000-0000-0000-000000000003",
        "blocked": "00000000-0000-0000-0000-000000000004",
    }
    for role, subject in subjects.items():
        permissions.set_role(session["workspace_id"], subject, "denied" if role == "blocked" else role)

    for subject in (subjects["owner"], subjects["editor"], subjects["viewer"]):
        inspection = asyncio.run(gateway.runtime_run_inspection(
            run["run_id"], _AuthorizedRequest(subject, secret), None, 100, None, None,
        ))
        assert inspection["run"]["run_id"] == run["run_id"]
    exported = asyncio.run(gateway.runtime_run_manifest_export(
        run["run_id"], _AuthorizedRequest(subjects["viewer"], secret),
    ))
    assert exported.status_code == 200
    asyncio.run(gateway.runtime_run_manifest(
        run["run_id"], _AuthorizedRequest(subjects["viewer"], secret, include_tool=False),
    ))

    try:
        asyncio.run(gateway.runtime_run_manifest(
            run["run_id"], _AuthorizedRequest(subjects["blocked"], secret),
        ))
    except gateway.HTTPException as exc:
        assert exc.status_code == 404
        assert exc.detail["code"] == "run_not_found"
    else:
        raise AssertionError("denied principal should not read a manifest")

    audit = gateway._runtime_security().audit.list()
    authorized = [row for row in audit if row["event"] == "operation.authorized"]
    assert {row["context"]["principal_id"] for row in authorized} >= {
        subjects["owner"], subjects["editor"], subjects["viewer"],
    }
    manifest_reads = [
        row for row in authorized
        if row["context"].get("operation_id") == "run.manifest.read"
    ]
    assert manifest_reads
    assert any(row["context"]["tool_id"] == "" for row in manifest_reads)
    assert all("safe input" not in json.dumps(row) for row in audit)
    operations = {
        row.get("detail", {}).get("resource", {}).get("operation")
        for row in authorized
        if isinstance(row.get("detail", {}).get("resource"), dict)
    }
    assert {"run.inspection.read", "run.manifest.export"} <= operations


def test_developer_flag_cannot_bypass_signed_runtime_identity(monkeypatch) -> None:
    monkeypatch.setenv("OPENDRSAI_DEV_AUTH_BYPASS", "1")
    from drsai.backend import gateway

    request = _Request()
    request.headers = Headers({
        "x-opendrsai-auth-mode": "offline",
        "x-opendrsai-principal": "00000000-0000-0000-0000-000000000001",
    })
    try:
        gateway._principal_from_request(request)
    except gateway.HTTPException as exc:
        assert exc.status_code == 401
        assert exc.detail["code"] == "invalid_token"
    else:
        raise AssertionError("unsigned developer identity must not enter the secured runtime")


def test_experiment_api_versioning_authorization_and_delete(tmp_path: Path, monkeypatch) -> None:
    secret = "experiment-api-secret"
    editor = "00000000-0000-4000-8000-000000000010"
    viewer = "00000000-0000-4000-8000-000000000011"
    monkeypatch.setenv("OPENDRSAI_OIDC_HS256_SECRET", secret)
    monkeypatch.setenv("OPENDRSAI_ENFORCE_WORKSPACE_PERMISSIONS", "1")
    gateway, _, session, run = _runtime(tmp_path, monkeypatch)
    gateway._runtime_security().permissions.set_role(session["workspace_id"], editor, "editor")
    gateway._runtime_security().permissions.set_role(session["workspace_id"], viewer, "viewer")
    editor_request = _AuthorizedRequest(editor, secret, extra_headers={"idempotency-key": "api-create"})
    create_model = gateway.RuntimeExperimentCreateRequest(
        title="API experiment", forked_from_item_id=f"user:{run['run_id']}",
    )
    created = asyncio.run(gateway.runtime_experiment_create(run["run_id"], create_model, editor_request))
    assert created.status_code == 201
    created_body = json.loads(created.body)
    experiment_id = created_body["experiment_id"]
    repeated = asyncio.run(gateway.runtime_experiment_create(run["run_id"], create_model, editor_request))
    assert repeated.status_code == 200
    assert json.loads(repeated.body)["experiment_id"] == experiment_id

    fetched = asyncio.run(gateway.runtime_experiment_get(experiment_id, _AuthorizedRequest(viewer, secret)))
    assert fetched["draft_version"] == 1
    update_request = _AuthorizedRequest(editor, secret, extra_headers={"idempotency-key": "api-save"})
    updated = asyncio.run(gateway.runtime_experiment_update(
        experiment_id,
        gateway.RuntimeExperimentUpdateRequest(expected_version=1, title="Updated API experiment"),
        update_request,
    ))
    assert updated["draft_version"] == 2
    try:
        asyncio.run(gateway.runtime_experiment_update(
            experiment_id,
            gateway.RuntimeExperimentUpdateRequest(expected_version=1, title="Stale"),
            _AuthorizedRequest(editor, secret, extra_headers={"idempotency-key": "api-stale"}),
        ))
    except gateway.HTTPException as exc:
        assert exc.status_code == 409
        assert exc.detail["code"] == "experiment_version_conflict"
    else:
        raise AssertionError("stale draft update must return 409")

    try:
        asyncio.run(gateway.runtime_experiment_create(
            run["run_id"],
            gateway.RuntimeExperimentCreateRequest(title="Viewer cannot create"),
            _AuthorizedRequest(viewer, secret, extra_headers={"idempotency-key": "viewer-create"}),
        ))
    except gateway.HTTPException as exc:
        assert exc.status_code == 403
    else:
        raise AssertionError("viewer must not create an experiment")

    relations = asyncio.run(gateway.runtime_run_relations(run["run_id"], _AuthorizedRequest(viewer, secret)))
    assert any(row["experiment_id"] == experiment_id for row in relations["experiments"])
    boundaries = asyncio.run(gateway.runtime_run_replay_boundaries(
        run["run_id"], _AuthorizedRequest(viewer, secret),
    ))
    assert boundaries["run_id"] == run["run_id"]
    plan = asyncio.run(gateway.runtime_replay_plan_create(
        experiment_id,
        gateway.RuntimeReplayPlanCreateRequest(expected_draft_version=2),
        _AuthorizedRequest(editor, secret),
    ))
    fetched_plan = asyncio.run(gateway.runtime_replay_plan_get(
        plan["replay_plan_id"], _AuthorizedRequest(viewer, secret),
    ))
    assert fetched_plan["plan_digest"] == plan["plan_digest"]
    deleted = asyncio.run(gateway.runtime_experiment_delete(experiment_id, _AuthorizedRequest(editor, secret)))
    assert deleted.status_code == 204


def test_experiment_plan_execute_compare_audit_chain_is_content_free(tmp_path: Path, monkeypatch) -> None:
    secret = "experiment-audit-secret"
    editor = "00000000-0000-4000-8000-000000000020"
    canary = "audit-secret-canary-do-not-store"
    monkeypatch.setenv("OPENDRSAI_OIDC_HS256_SECRET", secret)
    monkeypatch.setenv("OPENDRSAI_ENFORCE_WORKSPACE_PERMISSIONS", "1")
    gateway, engine, session, run = _runtime(tmp_path, monkeypatch)
    engine.update_run_manifest(run["run_id"], {"model": {"provider": "opendrsai", "id": "fixture-model"}})
    workspace_path = tmp_path / "workspace"
    (workspace_path / "README.md").write_text("experiment fixture\n", encoding="utf-8")
    for command in (
        ["git", "init"],
        ["git", "config", "user.email", "tests@opendrsai.local"],
        ["git", "config", "user.name", "OpenDrSai Tests"],
        ["git", "add", "README.md"],
        ["git", "commit", "-m", "fixture"],
    ):
        subprocess.run(command, cwd=workspace_path, check=True, capture_output=True, text=True)
    engine.transition_run(run["run_id"], "running")
    engine.transition_run(run["run_id"], "completed")
    gateway._runtime_security().permissions.set_role(session["workspace_id"], editor, "editor")

    created_response = asyncio.run(gateway.runtime_experiment_create(
        run["run_id"], gateway.RuntimeExperimentCreateRequest(title="Audited experiment"),
        _AuthorizedRequest(editor, secret, extra_headers={"idempotency-key": "audit-create"}),
    ))
    experiment = json.loads(created_response.body)
    updated = asyncio.run(gateway.runtime_experiment_update(
        experiment["experiment_id"],
        gateway.RuntimeExperimentUpdateRequest(expected_version=1, overrides={"input": {"message": canary}}),
        _AuthorizedRequest(editor, secret, extra_headers={"idempotency-key": "audit-update"}),
    ))
    plan = asyncio.run(gateway.runtime_replay_plan_create(
        experiment["experiment_id"],
        gateway.RuntimeReplayPlanCreateRequest(expected_draft_version=updated["draft_version"]),
        _AuthorizedRequest(editor, secret),
    ))

    class _AgentService:
        async def execute(self, run_id, _prompt, **_kwargs):
            engine.transition_run(run_id, "running")
            completed = engine.transition_run(run_id, "completed")
            return {"run": completed, "result": {"content": "safe"}}

    monkeypatch.setattr(gateway, "_runtime_agent_service", lambda *_args, **_kwargs: _AgentService())
    execute_model = gateway.RuntimeReplayExecuteRequest(
        draft_version=plan["draft_version"], plan_digest=plan["plan_digest"],
        base_manifest_digest=plan["base_manifest_digest"],
    )
    try:
        asyncio.run(gateway.runtime_replay_plan_execute(
            plan["replay_plan_id"], execute_model,
            _AuthorizedRequest(editor, secret, extra_headers={"idempotency-key": "audit-execute"}),
        ))
    except gateway.HTTPException as exc:
        assert exc.status_code == 428 and exc.detail["code"] == "approval_required"
        approval_id = exc.detail["detail"]["approval_id"]
    else:
        raise AssertionError("replay with side effects must require explicit approval")
    gateway._runtime_security().approvals.decide(approval_id, "approved")
    approved_execute_model = gateway.RuntimeReplayExecuteRequest(
        draft_version=plan["draft_version"], plan_digest=plan["plan_digest"],
        base_manifest_digest=plan["base_manifest_digest"], approval_id=approval_id,
    )
    executed = asyncio.run(gateway.runtime_replay_plan_execute(
        plan["replay_plan_id"], approved_execute_model,
        _AuthorizedRequest(editor, secret, extra_headers={
            "idempotency-key": "audit-execute",
            "x-opendrsai-approval-id": approval_id,
        }),
    ))
    comparison = asyncio.run(gateway.runtime_run_comparison_create(
        gateway.RuntimeRunComparisonCreateRequest(
            baseline_run_id=run["run_id"], candidate_run_id=executed["run"]["run_id"],
        ),
        _AuthorizedRequest(editor, secret),
    ))
    assert comparison["candidate_run_id"] == executed["run"]["run_id"]
    evaluation = asyncio.run(gateway.runtime_run_comparison_evaluation_create(
        comparison["comparison_id"],
        gateway.RuntimeRunComparisonEvaluationCreateRequest(
            expected_latest_revision=0,
            verdict="candidate_better",
            scores={criterion: {"baseline": 3, "candidate": 4} for criterion in (
                "outcome_quality", "execution_quality", "safety_reproducibility",
            )},
            note="Candidate is clearer.",
        ),
        _AuthorizedRequest(editor, secret, extra_headers={"idempotency-key": "audit-evaluation"}),
    ))
    assert evaluation["revision"] == 1
    evaluations = asyncio.run(gateway.runtime_run_comparison_evaluations_list(
        comparison["comparison_id"], _AuthorizedRequest(editor, secret),
    ))
    assert evaluations["latest_revision"] == 1
    assert evaluations["evaluations"][0]["verdict"] == "candidate_better"
    exported = asyncio.run(gateway.runtime_experiment_export(
        experiment["experiment_id"], _AuthorizedRequest(editor, secret),
    ))
    exported_body = json.loads(exported.body)
    assert exported_body["schema_version"] == "opendrsai.run-experiment-package/1"
    assert exported_body["integrity"]["digest"].startswith("sha256:")
    assert canary not in exported.body.decode("utf-8")
    assert exported.headers["cache-control"] == "no-store"

    audit = gateway._runtime_security().audit.list()
    operation_ids = {
        row["context"]["operation_id"] for row in audit
        if row["event"] == "operation.authorized"
    }
    assert {
        "run.experiment.create", "run.experiment.update", "run.replay-plan.create",
        "run.replay.execute", "run.comparison.create", "run.comparison-evaluation.create",
        "run.experiment.export",
    } <= operation_ids
    serialized = json.dumps(audit, ensure_ascii=False)
    assert canary not in serialized
    assert secret not in serialized
