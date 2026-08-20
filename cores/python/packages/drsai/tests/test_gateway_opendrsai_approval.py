from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest

from drsai.backend import gateway
from drsai.backend.runtime.agent import AgentDefinition, RuntimeExecutionError, RuntimeRunContext


class _ApprovalState:
    def __init__(self) -> None:
        self.created = asyncio.Event()
        self.approvals: dict[str, dict[str, object]] = {}
        self.resolve_count = 0
        self.side_effects: dict[str, dict[str, object]] = {}

    def request_approval(self, run_id, request, deadline_at=None):
        approval = {
            "approval_id": "approval-1", "run_id": run_id, "status": "pending",
            "request": request, "deadline_at": deadline_at,
        }
        self.approvals["approval-1"] = approval
        self.side_effects["approval-1"] = {
            "effect_id": "effect-1", "approval_id": "approval-1", "run_id": run_id,
            "idempotency_key": "side-effect:approval-1", "operation": request["operation"],
            "status": "requested", "recovered_at": None,
        }
        self.created.set()
        return approval

    def get_approval(self, approval_id):
        return self.approvals[approval_id]

    def resolve_approval(self, approval_id, decision, detail=None):
        self.resolve_count += 1
        self.approvals[approval_id]["status"] = decision
        self.approvals[approval_id]["decision"] = detail
        self.side_effects[approval_id]["status"] = "approved" if decision == "approved" else "rejected"
        return self.approvals[approval_id]

    def list_run_approvals(self, run_id):
        return [approval for approval in self.approvals.values() if approval["run_id"] == run_id]

    def get_side_effect(self, approval_id):
        return dict(self.side_effects[approval_id])

    def claim_side_effect(self, approval_id, run_id, operation, *, recovered=False):
        effect = self.side_effects[approval_id]
        if effect["run_id"] != run_id or effect["operation"] != operation:
            raise ValueError("side effect mismatch")
        if effect["status"] != "approved":
            raise ValueError("side effect not approved")
        effect["status"] = "executing"
        effect["recovered_at"] = "recovered" if recovered else None
        return dict(effect)

    def complete_side_effect(self, approval_id, _result):
        effect = self.side_effects[approval_id]
        if effect["status"] != "executing":
            raise ValueError("side effect not executing")
        effect["status"] = "completed"
        return dict(effect)

    def fail_side_effect(self, approval_id, error_code):
        effect = self.side_effects[approval_id]
        if effect["status"] != "executing":
            raise ValueError("side effect not executing")
        effect["status"] = "failed"
        effect["error_code"] = error_code
        return dict(effect)


def _context(tmp_path: Path) -> RuntimeRunContext:
    return RuntimeRunContext(
        "runtime", "instance", "workspace", tmp_path, "session", "run",
        "opendrsai", "1", correlation_id="correlation-run",
    )


def _definition() -> AgentDefinition:
    return AgentDefinition("opendrsai", "1", "opendrsai", "model", "", frozenset(), {})


@pytest.mark.parametrize("risk", [
    "low", "pure", "read", "read_only", "read-only-versioned", "read_only_mutable",
    "model", "internal", "diagnostic",
])
def test_production_low_risk_and_internal_registry_actions_do_not_request_approval(risk) -> None:
    assert gateway._runtime_tool_requires_approval({"risk": risk}) is False


@pytest.mark.parametrize("risk", ["workspace_write", "external_write", "shell", "high", "unknown", ""])
def test_production_high_or_unknown_risk_registry_actions_require_approval(risk) -> None:
    assert gateway._runtime_tool_requires_approval({"risk": risk}) is True


def test_production_backend_approval_suspends_and_resumes_once(monkeypatch, tmp_path) -> None:
    async def scenario() -> None:
        async def runner(**_kwargs):
            yield "approval"
            yield "start"
            yield "complete"
            yield "answer"

        monkeypatch.setattr(gateway, "get_platform_auth", lambda: SimpleNamespace(subject="user"))
        monkeypatch.setattr(
            gateway,
            "translate_conversation_event",
            lambda event, _state: [("interaction.request", {
                "interaction_type": "approval", "operation": "file.write",
                "prompt": "Allow writing the reviewed file?", "scope": "workspace",
            })] if event == "approval" else [("tool.start" if event == "start" else "tool.complete", {
                "tool_id": "call-1", "name": "file.write",
            })] if event in {"start", "complete"} else [("message.delta", {"text": "done"})],
        )
        state = _ApprovalState()
        emitted = []
        services = SimpleNamespace(state=state, emit=lambda *_args: emitted.append(_args[-2:]))
        backend = gateway.GatewayOpenDrSaiAgentBackend(runner)
        task = asyncio.create_task(backend.execute(_context(tmp_path), _definition(), "task", services))
        await asyncio.wait_for(state.created.wait(), timeout=1)
        assert not task.done()
        state.resolve_approval("approval-1", "approved", {"idempotency_key": "desktop-approval-1"})
        await backend.respond_approval("run", "approval-1", "approved")
        result = await asyncio.wait_for(task, timeout=1)
        assert result["content"] == "done"
        with pytest.raises(RuntimeExecutionError, match="no longer pending"):
            await backend.respond_approval("run", "approval-1", "approved")

    asyncio.run(scenario())


def test_production_backend_cancel_wakes_pending_approval(monkeypatch, tmp_path) -> None:
    async def scenario() -> None:
        async def runner(**_kwargs):
            yield "approval"

        monkeypatch.setattr(gateway, "get_platform_auth", lambda: SimpleNamespace(subject="user"))
        monkeypatch.setattr(
            gateway,
            "translate_conversation_event",
            lambda _event, _state: [("interaction.request", {
                "interaction_type": "approval", "operation": "file.write",
                "prompt": "Allow writing?", "scope": "workspace",
            })],
        )
        state = _ApprovalState()
        services = SimpleNamespace(state=state, emit=lambda *_args: None)
        backend = gateway.GatewayOpenDrSaiAgentBackend(runner)
        task = asyncio.create_task(backend.execute(_context(tmp_path), _definition(), "task", services))
        await asyncio.wait_for(state.created.wait(), timeout=1)
        await backend.cancel("run")
        with pytest.raises(RuntimeExecutionError) as caught:
            await asyncio.wait_for(task, timeout=1)
        assert caught.value.code == "run_cancelled"

    asyncio.run(scenario())


def test_production_manager_registry_approval_uses_runtime_channel(monkeypatch, tmp_path) -> None:
    async def scenario() -> None:
        async def run_stream(**kwargs):
            assert "tool_approval_handler" in kwargs
            approved = await kwargs["tool_approval_handler"]({
                "name": "external.publish", "executor_id": "workbench:external.publish",
                "risk": "external_write", "schema_sha256": "a" * 64,
            }, {"secret": "must-not-enter-approval-record"})
            assert approved is True
            yield "start"
            yield "complete"
            yield "answer"

        monkeypatch.setattr(gateway, "get_platform_auth", lambda: SimpleNamespace(subject="user"))
        monkeypatch.setattr(gateway.manager, "run_stream", run_stream)
        monkeypatch.setattr(
            gateway, "translate_conversation_event",
            lambda event, _state: [("tool.start" if event == "start" else "tool.complete", {
                "tool_id": "call-1", "name": "external.publish",
            })] if event in {"start", "complete"} else [("message.delta", {"text": "done"})],
        )
        state = _ApprovalState()
        services = SimpleNamespace(state=state, emit=lambda *_args: None)
        backend = gateway.GatewayOpenDrSaiAgentBackend()
        task = asyncio.create_task(backend.execute(_context(tmp_path), _definition(), "task", services))
        await asyncio.wait_for(state.created.wait(), timeout=1)
        request = state.approvals["approval-1"]["request"]
        assert request["operation"] == "external.publish"
        assert "external_write" in request["risk_summary"]
        assert "must-not-enter-approval-record" not in str(request)
        state.resolve_approval("approval-1", "approved", {"idempotency_key": "desktop-approval-1"})
        await backend.respond_approval("run", "approval-1", "approved")
        result = await asyncio.wait_for(task, timeout=1)
        assert result["content"] == "done"

    asyncio.run(scenario())


def test_regression_controlled_write_approval_records_only_safe_proposal(monkeypatch, tmp_path) -> None:
    async def scenario() -> None:
        content = "OpenDrSai approval regression passed.\n"

        async def run_stream(**kwargs):
            approved = await kwargs["tool_approval_handler"]({
                "name": "regression_controlled_write", "executor_id": "desktop-host",
                "risk": "external_write", "schema_sha256": "b" * 64,
            }, {
                "relative_path": "output/approval-proof.txt", "content": content,
            })
            assert approved is True
            yield "start"
            yield "complete"
            yield "answer"

        monkeypatch.setattr(gateway, "get_platform_auth", lambda: SimpleNamespace(subject="user"))
        monkeypatch.setattr(gateway.manager, "run_stream", run_stream)
        monkeypatch.setattr(
            gateway, "translate_conversation_event",
            lambda event, _state: [("tool.start" if event == "start" else "tool.complete", {
                "tool_id": "call-1", "name": "regression_controlled_write",
            })] if event in {"start", "complete"} else [("message.delta", {"text": "done"})],
        )
        state = _ApprovalState()
        emitted = []
        services = SimpleNamespace(state=state, emit=lambda *_args: emitted.append(_args[-2:]))
        backend = gateway.GatewayOpenDrSaiAgentBackend()
        task = asyncio.create_task(backend.execute(_context(tmp_path), _definition(), "task", services))
        await asyncio.wait_for(state.created.wait(), timeout=1)
        request = state.approvals["approval-1"]["request"]
        assert request["proposal"] == {
            "tool": "regression_controlled_write", "effect": "write_local_mutable",
            "relative_path": "output/approval-proof.txt",
            "content_sha256": __import__("hashlib").sha256(content.encode()).hexdigest(),
        }
        assert content not in str(request)
        state.resolve_approval("approval-1", "approved", {"idempotency_key": "desktop-approval-1"})
        await backend.respond_approval("run", "approval-1", "approved")
        await asyncio.wait_for(task, timeout=1)
        side_effects = [payload for _kind, payload in emitted if isinstance(payload, dict) and payload.get("side_effect")]
        assert side_effects
        assert len(side_effects[-1]["side_effect"]["idempotency_key_digest"]) == 64

    asyncio.run(scenario())


@pytest.mark.skipif(__import__("os").name != "nt", reason="Desktop edit proposal uses Windows filesystem boundary")
def test_bound_run_edit_approval_uses_source_and_result_digests_only(monkeypatch, tmp_path) -> None:
    async def scenario() -> None:
        from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
        from drsai.backend.runtime.permission_modes import (
            AdministratorPolicy, DEVELOPMENT_CAPABILITIES, ModeSelection,
            PlatformBoundary, WorkspaceContext,
        )

        workspace = tmp_path / "workspace"
        workspace.mkdir()
        target = workspace / "notes.txt"
        target.write_text("prefix secret-before suffix", encoding="utf-8")
        engine = RuntimeEngine(
            tmp_path / "runtime.sqlite3", RuntimeEngineIdentity("runtime", "instance"),
            lambda value: value == "workspace", lambda _value: None,
        )
        session = engine.create_session("workspace")
        run, _ = engine.create_run(session["session_id"], "opendrsai@1", "edit")
        engine.transition_run(run["run_id"], "running")
        engine.apply_permission_mode(
            run["run_id"], ModeSelection(
                "manual_safe", "user", False,
                requested_capabilities=frozenset({"filesystem.write"}),
            ),
            administrator=AdministratorPolicy(
                "organization", 1, True, capability_ceiling=DEVELOPMENT_CAPABILITIES,
            ),
            platform=PlatformBoundary(DEVELOPMENT_CAPABILITIES),
            workspace=WorkspaceContext(str(workspace), True),
        )

        class ObservableEngine:
            def __init__(self, authority):
                self.authority = authority
                self.created = asyncio.Event()

            def __getattr__(self, name):
                return getattr(self.authority, name)

            def request_approval(self, *args, **kwargs):
                approval = self.authority.request_approval(*args, **kwargs)
                self.created.set()
                return approval

        state = ObservableEngine(engine)
        context = RuntimeRunContext(
            "runtime", "instance", "workspace", workspace,
            session["session_id"], run["run_id"], "opendrsai", "1",
            correlation_id="correlation-edit",
        )
        observed = {}

        async def run_stream(**kwargs):
            assert kwargs["security_execution_binding"].runtime_run_id == run["run_id"]
            observed["authorization"] = await kwargs["tool_approval_handler"]({
                "call_id": "call-edit", "name": "run_edit",
                "executor_id": "workbench:run_edit", "risk": "local_write",
                "schema_sha256": "c" * 64,
            }, {
                "path": "notes.txt", "old_text": "secret-before", "new_text": "secret-after",
            })
            yield "start"
            yield "complete"
            yield "answer"

        monkeypatch.setattr(gateway, "get_platform_auth", lambda: SimpleNamespace(subject="user"))
        monkeypatch.setattr(gateway.manager, "run_stream", run_stream)
        monkeypatch.setattr(
            gateway, "translate_conversation_event",
            lambda event, _state: [
                ("tool.start" if event == "start" else "tool.complete", {
                    "tool_id": "call-edit", "name": "run_edit",
                })
            ] if event in {"start", "complete"} else [("message.delta", {"text": "done"})],
        )
        services = SimpleNamespace(state=state, emit=lambda *_args: None)
        backend = gateway.GatewayOpenDrSaiAgentBackend()
        task = asyncio.create_task(backend.execute(context, _definition(), "task", services))
        await asyncio.wait_for(state.created.wait(), timeout=2)
        legacy = engine.list_run_approvals(run["run_id"])[0]
        safe = legacy["request"]["proposal"]
        assert safe["tool"] == "run_edit"
        assert safe["relative_path"] == "notes.txt"
        assert safe["source_content_sha256"].startswith("sha256:")
        assert safe["result_content_sha256"].startswith("sha256:")
        assert "secret-before" not in str(legacy) and "secret-after" not in str(legacy)
        engine.resolve_approval(legacy["approval_id"], "approved", {"idempotency_key": "edit"})
        await backend.respond_approval(run["run_id"], legacy["approval_id"], "approved")
        assert (await asyncio.wait_for(task, timeout=2))["content"] == "done"
        assert observed["authorization"]["approved"] is True
        proposal = engine.security_boundary.get_proposal(observed["authorization"]["proposal_id"])
        assert proposal.operation == "file.edit"
        assert b"secret-before" not in engine.database.read_bytes()
        assert b"secret-after" not in engine.database.read_bytes()

    asyncio.run(scenario())


def test_auto_reviewed_bound_write_issues_auto_grant_without_human_approval(monkeypatch, tmp_path) -> None:
    async def scenario() -> None:
        from drsai.backend.runtime.desktop_security_binding import validate_desktop_authorization_grant
        from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
        from drsai.backend.runtime.permission_modes import (
            AdministratorPolicy, DEVELOPMENT_CAPABILITIES, ModeSelection,
            PlatformBoundary, WorkspaceContext,
        )

        workspace = tmp_path / "workspace"
        workspace.mkdir()
        engine = RuntimeEngine(
            tmp_path / "runtime.sqlite3", RuntimeEngineIdentity("runtime", "instance"),
            lambda value: value == "workspace", lambda _value: None,
        )
        session = engine.create_session("workspace")
        run, _ = engine.create_run(session["session_id"], "opendrsai@1", "auto-write")
        engine.transition_run(run["run_id"], "running")
        engine.apply_permission_mode(
            run["run_id"], ModeSelection(
                "auto_reviewed", "user", False,
                requested_capabilities=frozenset({"filesystem.write"}),
            ),
            administrator=AdministratorPolicy(
                "organization", 1, True, capability_ceiling=DEVELOPMENT_CAPABILITIES,
            ),
            platform=PlatformBoundary(DEVELOPMENT_CAPABILITIES),
            workspace=WorkspaceContext(str(workspace), True),
        )
        context = RuntimeRunContext(
            "runtime", "instance", "workspace", workspace,
            session["session_id"], run["run_id"], "opendrsai", "1",
            correlation_id="correlation-auto-write",
        )
        observed = {}

        async def run_stream(**kwargs):
            binding = kwargs["security_execution_binding"]
            assert binding.reviewer_route == "auto"
            observed["binding"] = binding
            observed["authorization"] = await kwargs["tool_approval_handler"]({
                "call_id": "call-auto-write", "name": "run_write",
                "executor_id": "workbench:run_write", "risk": "local_write",
                "schema_sha256": "d" * 64,
            }, {"path": "notes.txt", "content": "auto-approved-secret"})
            observed["denied"] = await kwargs["tool_approval_handler"]({
                "call_id": "call-auto-denied", "name": "run_write",
                "executor_id": "workbench:run_write", "risk": "local_write",
                "schema_sha256": "d" * 64,
            }, {"path": ".git/config", "content": "must-not-write"})
            yield "answer"

        monkeypatch.setattr(gateway, "get_platform_auth", lambda: SimpleNamespace(subject="user"))
        monkeypatch.setattr(gateway.manager, "run_stream", run_stream)
        monkeypatch.setattr(
            gateway, "translate_conversation_event",
            lambda _event, _state: [("message.delta", {"text": "done"})],
        )
        services = SimpleNamespace(state=engine, emit=lambda *_args: None)
        result = await gateway.GatewayOpenDrSaiAgentBackend().execute(
            context, _definition(), "task", services,
        )

        assert result["content"] == "done"
        authorization = observed["authorization"]
        assert authorization["approved"] is True
        assert observed["denied"] == {
            "approved": False, "reason_code": "auto_deny.control_path",
        }
        validate_desktop_authorization_grant(
            observed["binding"], grant_id=authorization["grant_id"],
            proposal_id=authorization["proposal_id"],
        )
        assert engine.list_run_approvals(run["run_id"]) == []
        requests = engine.authorization_approvals.list_requests(run["run_id"])
        assert len(requests) == 2 and all(request.reviewer_kind == "auto" for request in requests)
        decisions = [engine.authorization_approvals.get_decision(request.request_id) for request in requests]
        assert {decision.decision for decision in decisions if decision is not None} == {"approved", "denied"}
        assert all(decision is not None and decision.reviewer_kind == "auto" for decision in decisions)
        assert b"auto-approved-secret" not in engine.database.read_bytes()
        assert b"must-not-write" not in engine.database.read_bytes()

    asyncio.run(scenario())


@pytest.mark.parametrize("human_decision", ["approved", "denied", "timeout"])
def test_auto_reviewed_escalation_hands_same_proposal_to_human_once(
    monkeypatch, tmp_path, human_decision: str,
) -> None:
    async def scenario() -> None:
        from drsai.backend.runtime.desktop_security_binding import validate_desktop_authorization_grant
        from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
        from drsai.backend.runtime.permission_modes import (
            AdministratorPolicy, AutoReviewCoordinator, AutoReviewerConfig, AutoReviewerService,
            DEVELOPMENT_CAPABILITIES, ModeSelection, PlatformBoundary, WorkspaceContext,
        )

        workspace = tmp_path / "workspace"
        workspace.mkdir()
        engine = RuntimeEngine(
            tmp_path / "runtime.sqlite3", RuntimeEngineIdentity("runtime", "instance"),
            lambda value: value == "workspace", lambda _value: None,
        )
        session = engine.create_session("workspace")
        run, _ = engine.create_run(session["session_id"], "opendrsai@1", "auto-escalation")
        engine.transition_run(run["run_id"], "running")
        engine.apply_permission_mode(
            run["run_id"], ModeSelection(
                "auto_reviewed", "user", False,
                requested_capabilities=frozenset({"filesystem.write"}),
            ),
            administrator=AdministratorPolicy(
                "organization", 1, True, capability_ceiling=DEVELOPMENT_CAPABILITIES,
            ), platform=PlatformBoundary(DEVELOPMENT_CAPABILITIES),
            workspace=WorkspaceContext(str(workspace), True),
        )
        context = RuntimeRunContext(
            "runtime", "instance", "workspace", workspace,
            session["session_id"], run["run_id"], "opendrsai", "1",
            correlation_id="correlation-auto-escalation",
        )

        def force_safe_escalation(proposal, profile, *, idempotency_key, human_deadline_seconds=300):
            effective = engine.effective_permission_profile(proposal.run_id)
            request = engine.request_authorization_review(
                proposal, profile, reviewer_kind="auto",
                reason_code="permission_mode_auto_review",
                idempotency_key=f"auto-request:{idempotency_key}",
            )
            reviewer = AutoReviewerService(
                engine.database, AutoReviewerConfig(enabled=False), model=None,
            )
            return AutoReviewCoordinator(engine.database, reviewer).process(
                request.request_id, effective,
                idempotency_key=f"auto-route:{idempotency_key}",
                human_deadline_seconds=human_deadline_seconds,
            )

        engine.route_auto_authorization_review = force_safe_escalation

        class ObservableEngine:
            def __init__(self, authority):
                self.authority = authority
                self.created = asyncio.Event()

            def __getattr__(self, name):
                return getattr(self.authority, name)

            def request_approval(self, *args, **kwargs):
                approval = self.authority.request_approval(*args, **kwargs)
                self.created.set()
                return approval

        state = ObservableEngine(engine)
        observed = {}

        async def run_stream(**kwargs):
            observed["binding"] = kwargs["security_execution_binding"]
            observed["authorization"] = await kwargs["tool_approval_handler"]({
                "call_id": "call-auto-escalation", "name": "run_write",
                "executor_id": "workbench:run_write", "risk": "local_write",
                "schema_sha256": "e" * 64,
            }, {"path": "release.txt", "content": "escalation-secret"})
            yield "start"
            yield "complete"
            yield "answer"

        monkeypatch.setattr(gateway, "get_platform_auth", lambda: SimpleNamespace(subject="user"))
        monkeypatch.setattr(gateway.manager, "run_stream", run_stream)
        monkeypatch.setattr(
            gateway, "translate_conversation_event",
            lambda event, _state: [
                ("tool.start" if event == "start" else "tool.complete", {
                    "tool_id": "call-auto-escalation", "name": "run_write",
                })
            ] if event in {"start", "complete"} else [("message.delta", {"text": "done"})],
        )
        services = SimpleNamespace(state=state, emit=lambda *_args: None)
        backend = gateway.GatewayOpenDrSaiAgentBackend()
        if human_decision == "timeout":
            original_await_approval = backend._await_approval

            async def short_approval(context_value, payload, services_value):
                return await original_await_approval(
                    context_value, {**payload, "timeout_seconds": 1}, services_value,
                )

            backend._await_approval = short_approval
        task = asyncio.create_task(backend.execute(context, _definition(), "task", services))
        await asyncio.wait_for(state.created.wait(), timeout=2)
        legacy = engine.list_run_approvals(run["run_id"])
        assert len(legacy) == 1 and legacy[0]["status"] == "pending"
        assert "escalation-secret" not in str(legacy[0])
        if human_decision == "timeout":
            with pytest.raises(RuntimeExecutionError) as timed_out:
                await asyncio.wait_for(task, timeout=2)
            assert timed_out.value.code == "approval_timeout"
            requests = engine.authorization_approvals.list_requests(run["run_id"])
            assert [request.reviewer_kind for request in requests] == ["auto", "human"]
            assert [request.status for request in requests] == ["cancelled", "cancelled"]
            assert engine.authorization_grants.get_for_request(requests[1].request_id) is None
            return
        engine.resolve_approval(
            legacy[0]["approval_id"], human_decision, {"idempotency_key": "escalated-human"},
        )
        await backend.respond_approval(run["run_id"], legacy[0]["approval_id"], human_decision)

        if human_decision == "denied":
            with pytest.raises(RuntimeExecutionError) as rejected:
                await asyncio.wait_for(task, timeout=2)
            assert rejected.value.code == "approval_denied"
            requests = engine.authorization_approvals.list_requests(run["run_id"])
            assert [request.reviewer_kind for request in requests] == ["auto", "human"]
            assert [request.status for request in requests] == ["cancelled", "denied"]
            assert engine.authorization_grants.get_for_request(requests[1].request_id) is None
            return

        assert (await asyncio.wait_for(task, timeout=2))["content"] == "done"

        authorization = observed["authorization"]
        validate_desktop_authorization_grant(
            observed["binding"], grant_id=authorization["grant_id"],
            proposal_id=authorization["proposal_id"],
        )
        requests = engine.authorization_approvals.list_requests(run["run_id"])
        assert [request.reviewer_kind for request in requests] == ["auto", "human"]
        assert [request.status for request in requests] == ["cancelled", human_decision]
        assert requests[0].proposal_id == requests[1].proposal_id == authorization["proposal_id"]
        assert b"escalation-secret" not in engine.database.read_bytes()

    asyncio.run(scenario())


def test_isolated_full_bound_write_stays_closed_without_isolated_effect_executor(monkeypatch, tmp_path) -> None:
    async def scenario() -> None:
        import time

        from drsai.backend.runtime.engine import RuntimeEngine, RuntimeEngineIdentity
        from drsai.backend.runtime.permission_modes import (
            AdministratorPolicy, DEVELOPMENT_CAPABILITIES, ModeSelection,
            PlatformBoundary, WorkspaceContext,
        )
        from drsai.backend.runtime.security_boundary import IsolationAttestation

        workspace = tmp_path / "workspace"
        workspace.mkdir()
        now = time.time()
        attestation = IsolationAttestation(
            "windows-appcontainer-session", "1", "windows", now - 1, now + 60,
            frozenset({
                "non_admin_identity", "process_tree_controlled",
                "filesystem_enforced", "environment_sanitized",
            }), "sha256:isolated-gateway-evidence",
        )
        engine = RuntimeEngine(
            tmp_path / "runtime.sqlite3", RuntimeEngineIdentity("runtime", "instance"),
            lambda value: value == "workspace", lambda _value: None,
        )
        session = engine.create_session("workspace")
        run, _ = engine.create_run(session["session_id"], "opendrsai@1", "isolated-write")
        engine.transition_run(run["run_id"], "running")
        engine.apply_permission_mode(
            run["run_id"], ModeSelection("isolated_full_access", "user", True),
            administrator=AdministratorPolicy(
                "organization", 1, True, capability_ceiling=DEVELOPMENT_CAPABILITIES,
            ),
            platform=PlatformBoundary(DEVELOPMENT_CAPABILITIES, isolation_attestation=attestation),
            workspace=WorkspaceContext(str(workspace), True),
        )
        context = RuntimeRunContext(
            "runtime", "instance", "workspace", workspace,
            session["session_id"], run["run_id"], "opendrsai", "1",
            correlation_id="correlation-isolated-write",
        )
        observed = {}

        async def run_stream(**kwargs):
            assert kwargs["security_execution_binding"].reviewer_route == "none"
            try:
                await kwargs["tool_approval_handler"]({
                    "call_id": "call-isolated-write", "name": "run_write",
                    "executor_id": "workbench:run_write", "risk": "local_write",
                    "schema_sha256": "f" * 64,
                }, {"path": "notes.txt", "content": "must-not-write"})
            except RuntimeExecutionError as error:
                observed["error"] = error.code
            yield "answer"

        monkeypatch.setattr(gateway, "get_platform_auth", lambda: SimpleNamespace(subject="user"))
        monkeypatch.setattr(gateway.manager, "run_stream", run_stream)
        monkeypatch.setattr(
            gateway, "translate_conversation_event",
            lambda _event, _state: [("message.delta", {"text": "done"})],
        )
        result = await gateway.GatewayOpenDrSaiAgentBackend().execute(
            context, _definition(), "task", SimpleNamespace(state=engine, emit=lambda *_args: None),
        )
        assert result["content"] == "done"
        assert observed["error"] == "desktop_workspace_reviewer_unavailable"
        assert engine.list_run_approvals(run["run_id"]) == []
        assert engine.authorization_approvals.list_requests(run["run_id"]) == []
        assert not (workspace / "notes.txt").exists()

    asyncio.run(scenario())


def test_real_agent_start_before_approval_binds_side_effect_by_runtime_call_id(monkeypatch, tmp_path) -> None:
    async def scenario() -> None:
        async def run_stream(**kwargs):
            yield "start"
            approved = await kwargs["tool_approval_handler"]({
                # Real Agent registry records may omit optional diagnostic metadata.
                "name": "image_generation", "risk": "external_write",
            }, {"prompt": "draw"})
            assert approved is True
            yield "complete"
            yield "answer"

        monkeypatch.setattr(gateway, "get_platform_auth", lambda: SimpleNamespace(subject="user"))
        monkeypatch.setattr(gateway.manager, "run_stream", run_stream)
        monkeypatch.setattr(
            gateway, "translate_conversation_event",
            lambda event, _state: [("tool.start" if event == "start" else "tool.complete", {
                "tool_id": "call-1", "name": "image_generation",
            })] if event in {"start", "complete"} else [("message.delta", {"text": "done"})],
        )
        state = _ApprovalState()
        emitted = []
        services = SimpleNamespace(state=state, emit=lambda *_args: emitted.append(_args[-2:]))
        backend = gateway.GatewayOpenDrSaiAgentBackend()
        task = asyncio.create_task(backend.execute(_context(tmp_path), _definition(), "task", services))
        await asyncio.wait_for(state.created.wait(), timeout=1)
        state.resolve_approval("approval-1", "approved", {"idempotency_key": "image-1"})
        await backend.respond_approval("run", "approval-1", "approved")

        assert (await asyncio.wait_for(task, timeout=1))["content"] == "done"
        assert state.side_effects["approval-1"]["status"] == "completed"
        assert any(event_type == "side_effect.started" for event_type, _payload in emitted)
        assert backend._active_effects == {}

    asyncio.run(scenario())


def test_approved_image_tool_failure_records_failed_effect_not_fake_completion(monkeypatch, tmp_path) -> None:
    async def scenario() -> None:
        async def run_stream(**kwargs):
            yield "start"
            assert await kwargs["tool_approval_handler"]({
                "name": "image_generation", "executor_id": "workbench:image_generation",
                "risk": "external_write", "schema_sha256": "c" * 64,
            }, {"_runtime_call_id": "call-1"})
            yield "failed"

        monkeypatch.setattr(gateway, "get_platform_auth", lambda: SimpleNamespace(subject="user"))
        monkeypatch.setattr(gateway.manager, "run_stream", run_stream)
        monkeypatch.setattr(
            gateway, "translate_conversation_event",
            lambda event, _state: [("tool.start" if event == "start" else "tool.complete", {
                "tool_id": "call-1", "name": "image_generation",
                "is_error": event == "failed", "result": "image_provider_invalid_response",
            })],
        )
        state = _ApprovalState()
        services = SimpleNamespace(state=state, emit=lambda *_args: None)
        backend = gateway.GatewayOpenDrSaiAgentBackend()
        task = asyncio.create_task(backend.execute(_context(tmp_path), _definition(), "task", services))
        await asyncio.wait_for(state.created.wait(), timeout=1)
        state.resolve_approval("approval-1", "approved", {"idempotency_key": "image-failure"})
        await backend.respond_approval("run", "approval-1", "approved")

        await asyncio.wait_for(task, timeout=1)
        assert state.side_effects["approval-1"]["status"] == "failed"
        assert state.side_effects["approval-1"]["error_code"] == "tool_execution_failed"

    asyncio.run(scenario())


def test_backend_approval_endpoint_normalizes_desktop_decision(monkeypatch) -> None:
    observed: list[tuple[str, str, str]] = []

    class Service:
        async def respond_approval(self, run_id, approval_id, decision):
            observed.append((run_id, approval_id, decision))

    class Engine:
        def get_approval(self, approval_id):
            return {"approval_id": approval_id, "run_id": "run", "status": "pending"}

        def resolve_approval(self, approval_id, decision, detail):
            assert detail["idempotency_key"] == f"agent-backend:{approval_id}:{decision}"
            return {"approval_id": approval_id, "status": decision}

    monkeypatch.setattr(gateway, "_runtime_agent_service", lambda: Service())
    monkeypatch.setattr(gateway, "_runtime_engine", lambda: Engine())
    result = asyncio.run(gateway.runtime_backend_approval_decision(
        "run", "approval-1", gateway.RuntimeApprovalDecisionRequest(decision="acceptForSession"),
    ))
    assert observed == [("run", "approval-1", "approved")]
    assert result["status"] == "approved"


def test_backend_approval_endpoint_persists_restart_decision_when_waiter_is_gone(monkeypatch) -> None:
    class Service:
        async def respond_approval(self, _run_id, _approval_id, _decision):
            raise RuntimeExecutionError("approval_not_found", "waiter restarted")

    state = _ApprovalState()
    state.request_approval("run", {"operation": "file.write"})
    monkeypatch.setattr(gateway, "_runtime_agent_service", lambda: Service())
    monkeypatch.setattr(gateway, "_runtime_engine", lambda: state)
    result = asyncio.run(gateway.runtime_backend_approval_decision(
        "run", "approval-1", gateway.RuntimeApprovalDecisionRequest(decision="accept"),
    ))
    assert result["status"] == "approved"
    assert state.resolve_count == 1


def test_backend_approval_endpoint_replays_same_decision_without_resuming_side_effect(monkeypatch) -> None:
    class Service:
        async def respond_approval(self, *_args):
            raise AssertionError("an already-resolved approval must not be resumed")

    class Engine:
        def get_approval(self, approval_id):
            return {
                "approval_id": approval_id, "run_id": "run", "status": "approved",
                "decision": {"idempotency_key": "desktop-owned-key"},
            }

    monkeypatch.setattr(gateway, "_runtime_agent_service", lambda: Service())
    monkeypatch.setattr(gateway, "_runtime_engine", lambda: Engine())
    result = asyncio.run(gateway.runtime_backend_approval_decision(
        "run", "approval-1", gateway.RuntimeApprovalDecisionRequest(decision="accept"),
    ))
    assert result == {
        "run_id": "run", "approval_id": "approval-1", "decision": "approved",
        "status": "approved", "replayed": True,
    }


@pytest.mark.parametrize("mode,iteration", [
    (mode, iteration) for mode in ("allow", "deny", "timeout", "restart") for iteration in range(5)
])
def test_production_backend_approval_twenty_round_stability(monkeypatch, tmp_path, mode, iteration) -> None:
    async def scenario() -> None:
        side_effects = 0

        async def runner(**_kwargs):
            nonlocal side_effects
            yield "approval"
            side_effects += 1
            yield "start"
            yield "complete"
            yield "answer"

        monkeypatch.setattr(gateway, "get_platform_auth", lambda: SimpleNamespace(subject="user"))
        monkeypatch.setattr(gateway, "translate_conversation_event", lambda event, _state: [
            ("interaction.request", {
                "interaction_type": "approval", "operation": "file.write",
                "prompt": f"Allow round {iteration}?", "scope": "workspace",
                "timeout_seconds": 0.01 if mode == "timeout" else 5,
            }) if event == "approval" else ("tool.start" if event == "start" else "tool.complete", {
                "tool_id": "call-1", "name": "file.write",
            }) if event in {"start", "complete"} else ("message.delta", {"text": "done"})
        ])
        state = _ApprovalState()
        services = SimpleNamespace(state=state, emit=lambda *_args: None)
        backend = gateway.GatewayOpenDrSaiAgentBackend(runner)
        task = asyncio.create_task(backend.execute(_context(tmp_path), _definition(), "task", services))
        await asyncio.wait_for(state.created.wait(), timeout=1)

        if mode == "allow":
            state.resolve_approval("approval-1", "approved", {"idempotency_key": "allow"})
            await backend.respond_approval("run", "approval-1", "approved")
            assert (await task)["content"] == "done"
            assert side_effects == 1
        elif mode == "deny":
            state.resolve_approval("approval-1", "denied", {"idempotency_key": "deny"})
            await backend.respond_approval("run", "approval-1", "denied")
            with pytest.raises(RuntimeExecutionError) as caught:
                await task
            assert caught.value.code == "approval_denied"
            assert side_effects == 0
        elif mode == "timeout":
            with pytest.raises(RuntimeExecutionError) as caught:
                await task
            assert caught.value.code == "approval_timeout"
            assert state.resolve_count == 1
            assert side_effects == 0
        else:
            await backend.close()
            with pytest.raises(RuntimeExecutionError) as caught:
                await task
            assert caught.value.code == "run_cancelled"
            state.resolve_approval("approval-1", "approved", {"idempotency_key": "restart"})
            recovered = gateway.GatewayOpenDrSaiAgentBackend(runner)
            await recovered.recover("run")
            assert (await recovered.execute(_context(tmp_path), _definition(), "task", services))["content"] == "done"
            assert side_effects == 1

    asyncio.run(scenario())


def test_production_backend_tool_events_share_stable_runtime_identity(monkeypatch, tmp_path) -> None:
    async def scenario() -> None:
        async def runner(**_kwargs):
            yield "start"
            yield "complete"

        monkeypatch.setattr(gateway, "get_platform_auth", lambda: SimpleNamespace(subject="user"))
        monkeypatch.setattr(
            gateway,
            "translate_conversation_event",
            lambda event, _state: [("tool.start" if event == "start" else "tool.complete", {
                "tool_id": "call-1", "name": "skill.presentations", "tool_kind": "skill",
            })],
        )
        emitted = []
        services = SimpleNamespace(emit=lambda *_args: emitted.append(_args[-2:]))
        await gateway.GatewayOpenDrSaiAgentBackend(runner).execute(
            _context(tmp_path), _definition(), "task", services,
        )
        tools = [(event_type, payload) for event_type, payload in emitted if event_type.startswith("tool.")]
        assert [event_type for event_type, _payload in tools] == ["tool.started", "tool.completed"]
        for _event_type, payload in tools:
            assert payload["run_id"] == "run"
            assert payload["call_id"] == "call-1"
            assert payload["operation_id"] == "run:call-1"
            assert payload["correlation_id"] == "correlation-run"
            assert payload["workspace_id"] == "workspace"
            assert payload["operation_ref"] == {
                "protocol": "owop/1",
                "operation_id": "run:call-1",
                "workspace_id": "workspace",
                "operation": "skill.presentations",
                "correlation_id": "correlation-run",
            }

    asyncio.run(scenario())


def test_production_backend_rejects_tool_or_skill_events_without_call_identity(tmp_path) -> None:
    context = _context(tmp_path)
    for name in ("workspace.write", "skill.presentations"):
        with pytest.raises(RuntimeExecutionError, match="call identity") as caught:
            gateway.GatewayOpenDrSaiAgentBackend._normalize_event(
                context, "tool.start", {"name": name},
            )
        assert caught.value.code == "tool_identity_missing"
