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
