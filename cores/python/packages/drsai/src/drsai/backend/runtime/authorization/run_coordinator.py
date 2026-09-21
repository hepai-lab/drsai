"""Pure Run-state projection and operation-level rejection results."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .approval_service import ApprovalRequest


@dataclass(frozen=True)
class RunApprovalProjection:
    @staticmethod
    def status(
        current_status: str,
        *,
        runnable_steps: int,
        pending_requests: int,
    ) -> str:
        if current_status in {"completed", "cancelled", "failed"}:
            return current_status
        if runnable_steps < 0 or pending_requests < 0:
            raise ValueError("Run projection counts cannot be negative.")
        return "waiting_approval" if runnable_steps == 0 and pending_requests > 0 else "running"

    @staticmethod
    def tool_result(request: ApprovalRequest, *, reason_code: str | None = None) -> dict[str, Any]:
        if request.status not in {"denied", "cancelled", "expired"}:
            raise ValueError("Only non-approved terminal requests produce rejection tool results.")
        return {
            "type": "tool_result",
            "outcome": request.status,
            "approval_request_id": request.request_id,
            "proposal_id": request.proposal_id,
            "reason_code": reason_code or f"approval_{request.status}",
            "retryable": False,
            "run_action": "continue",
        }

    @staticmethod
    def cancel_run_command(run_id: str, *, reason_code: str) -> dict[str, str]:
        if not run_id or not reason_code:
            raise ValueError("Run cancellation identity is required.")
        return {"type": "run_command", "action": "cancel", "run_id": run_id, "reason_code": reason_code}

