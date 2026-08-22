from __future__ import annotations

import json
from types import SimpleNamespace

from drsai.backend.runtime.agent import RuntimeExecutionError
from drsai.backend.runtime.error_contract import ERROR_CATEGORIES, RECOVERY_ACTIONS, error_envelope


def test_all_public_error_categories_have_structured_recovery_actions() -> None:
    fixtures = {
        "codex_session_binding_conflict": "binding",
        "codex_authentication_required": "auth",
        "codex_connection_eof": "transport",
        "codex_contract_incompatible": "contract",
        "codex_model_incompatible": "model",
        "approval_expired": "approval",
        "input_resource_unavailable": "resource",
        "history_cursor_expired": "history",
        "runtime_client_generation_invalidated": "runtime",
        "backend_fault": "backend",
    }
    assert set(fixtures.values()) == ERROR_CATEGORIES - {"unknown"}
    for code, category in fixtures.items():
        value = error_envelope(code, retryable=True)
        assert value["category"] == category
        assert value["recovery_actions"]
        assert set(value["recovery_actions"]) <= RECOVERY_ACTIONS
        assert value["user_message_key"] == f"errors.{category}.{code}"
        assert value["diagnostic_reference"].startswith("diag-")


def test_runtime_error_envelope_redacts_content_and_preserves_code() -> None:
    error = RuntimeExecutionError(
        "input_resource_unavailable",
        "Reattach the resource.",
        retryable=True,
        detail={
            "run_id": "run-1",
            "path": "C:/PRIVATE-PATH-CANARY",
            "prompt": "USER-TEXT-CANARY",
            "token": "SECRET-CANARY",
            "reason": "ValueError",
        },
    ).as_dict()
    assert error["code"] == "input_resource_unavailable"
    assert error["category"] == "resource"
    assert error["retryable"] is True
    assert error["detail"] == {"run_id": "run-1", "reason": "ValueError"}
    assert all(canary not in str(error) for canary in (
        "PRIVATE-PATH-CANARY", "USER-TEXT-CANARY", "SECRET-CANARY",
    ))


def test_gateway_error_uses_correlation_as_copyable_diagnostic_reference() -> None:
    from drsai.backend.gateway import _protocol_error

    request = SimpleNamespace(state=SimpleNamespace(correlation_id="correlation-safe-1"))
    response = _protocol_error(
        request, 409, "codex_session_resume_required", "backend prose can change", True,
        {"run_id": "run-safe", "prompt": "PROMPT-CANARY", "path": "PRIVATE-PATH-CANARY"},
    )
    error = json.loads(response.body)["error"]
    assert error["diagnostic_reference"] == "correlation-safe-1"
    assert error["category"] == "binding"
    assert error["detail"] == {"run_id": "run-safe"}
    assert "CANARY" not in str(error)


def test_gateway_approval_error_preserves_only_the_opaque_approval_id() -> None:
    from drsai.backend.gateway import _protocol_error

    request = SimpleNamespace(state=SimpleNamespace(correlation_id="correlation-approval-1"))
    response = _protocol_error(
        request, 428, "approval_required", "Approval is required.", True,
        {"approval_id": "approval-safe-1", "prompt": "PROMPT-CANARY", "token": "SECRET-CANARY"},
    )
    error = json.loads(response.body)["error"]
    assert error["detail"] == {"approval_id": "approval-safe-1"}
    assert error["redacted_details"] == {"approval_id": "approval-safe-1"}
    assert "CANARY" not in str(error)
