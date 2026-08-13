#!/usr/bin/env python3
"""Verify that RemoteSessionViewModel delegates volatile concerns to pure state machines."""
from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DOMAIN = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteSessionStateMachines.kt"
VIEW_MODEL = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteSessionViewModel.kt"
TEST = ROOT / "apps/android/app/src/test/java/ai/drsai/remote/remote/data/RemoteSessionStateMachinesTest.kt"


def verify() -> dict[str, object]:
    domain = DOMAIN.read_text(encoding="utf-8")
    view_model = VIEW_MODEL.read_text(encoding="utf-8")
    tests = TEST.read_text(encoding="utf-8")
    machines = (
        "SessionSyncStateMachine", "SessionProjectionStateMachine",
        "SessionRunControlStateMachine", "SessionApprovalStateMachine",
        "SessionDraftStateMachine",
    )
    for machine in machines:
        if f"class {machine}" not in domain:
            raise ValueError(f"p6_session_state_machine_missing:{machine}")
        if f"{machine}(" not in view_model:
            raise ValueError(f"p6_session_state_machine_not_integrated:{machine}")
    for marker in (
        "repeat(10_000)", "session_projection_cursor_regression",
        "session_run_control_busy", "session_approval_not_pending", "persistedRevision",
    ):
        if marker not in f"{domain}\n{tests}":
            raise ValueError(f"p6_session_state_machine_gate_missing:{marker}")
    for forbidden in (
        "OkHttpClient(", "Request.Builder(", "RelaySseClient(", "HttpRelayDiscoveryService(",
    ):
        if forbidden in view_model:
            raise ValueError(f"p6_session_view_model_direct_http:{forbidden}")
    for marker in (
        "syncStateMachine.accept", "projectionStateMachine.observe",
        "runControlStateMachine.begin", "approvalStateMachine.begin", "draftStateMachine.edit",
    ):
        if marker not in view_model:
            raise ValueError(f"p6_session_state_machine_path_missing:{marker}")
    return {"machines": len(machines), "direct_http": 0, "passed": True}


def main() -> int:
    try:
        value = verify()
    except (OSError, ValueError) as exc:
        raise SystemExit(str(exc)) from exc
    print(json.dumps(value, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
