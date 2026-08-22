"""Run deterministic host-independent stress loops for the mobile Python Core."""

from __future__ import annotations

import argparse
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    repo = args.repo.resolve()
    sys.path.insert(0, str(repo / "cores/python/packages/drsai/src"))
    from drsai.backend.runtime.mobile_core import MessageType, RuntimeEnvelope, create_mobile_agent_core

    def command(kind, run_id: str, session_id: str, sequence: int, payload: dict, key: str | None = None):
        return RuntimeEnvelope(
            message_type=kind, request_id=f"{run_id}:{sequence}", run_id=run_id, session_id=session_id,
            sequence=sequence, idempotency_key=key or f"{run_id}:key:{sequence}", payload=payload,
        )

    failures: list[str] = []
    duplicate_side_effects = 0
    started = time.perf_counter()
    for index in range(500):
        run_id, session_id = f"short-{index}", f"short-session-{index}"
        core = create_mobile_agent_core()
        core.handle(command(MessageType.START_RUN, run_id, session_id, 0, {"input": "hello", "model_id": "model"}))
        end = core.handle(command(MessageType.MODEL_COMPLETED, run_id, session_id, 1, {"content": "done"}))
        if end[0].payload.get("kind") != "run.completed":
            failures.append(run_id)
    for index in range(50):
        run_id, session_id, call_id = f"tool-{index}", f"tool-session-{index}", f"call-{index}"
        core = create_mobile_agent_core()
        core.handle(command(MessageType.START_RUN, run_id, session_id, 0, {"input": "tool", "model_id": "model"}))
        core.handle(command(MessageType.MODEL_COMPLETED, run_id, session_id, 1, {
            "tool_calls": [{"call_id": call_id, "name": "clock", "arguments": {}}],
        }))
        result = command(MessageType.TOOL_RESULT, run_id, session_id, 2, {
            "call_id": call_id, "succeeded": True, "content": {"value": index},
        })
        first = core.handle(result)
        replay = core.handle(result)
        if replay != first:
            duplicate_side_effects += 1
        core.handle(command(MessageType.MODEL_COMPLETED, run_id, session_id, 3, {"content": "done"}))
    for index in range(20):
        run_id, session_id, call_id = f"recover-{index}", f"recover-session-{index}", f"recover-call-{index}"
        first = create_mobile_agent_core()
        first.handle(command(MessageType.START_RUN, run_id, session_id, 0, {"input": "recover", "model_id": "model"}))
        outbound = first.handle(command(MessageType.MODEL_COMPLETED, run_id, session_id, 1, {
            "tool_calls": [{"call_id": call_id, "name": "clock", "arguments": {}}],
        }))
        checkpoint = next(item.payload["state"] for item in outbound if item.message_type is MessageType.CHECKPOINT_REQUEST)
        recovered = create_mobile_agent_core()
        requests = recovered.handle(command(MessageType.RESUME_RUN, run_id, session_id, 2, {"state": checkpoint}))
        tool_requests = [item for item in requests if item.message_type is MessageType.TOOL_CALL_REQUEST]
        if len(tool_requests) != 1:
            failures.append(run_id)
        recovered.handle(command(MessageType.TOOL_RESULT, run_id, session_id, 3, {
            "call_id": call_id, "succeeded": True, "content": {"value": index},
        }))
        recovered.handle(command(MessageType.MODEL_COMPLETED, run_id, session_id, 4, {"content": "done"}))
    duration = time.perf_counter() - started
    evidence = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "environment": "desktop_automation_python_3_11",
        "runs": {"short": 500, "tool": 50, "recovery": 20},
        "duration_seconds": round(duration, 6),
        "failures": failures,
        "duplicate_side_effects": duplicate_side_effects,
        "anr": "not_applicable_host_independent",
        "device_metrics": "not_executed_no_adb_device",
        "result": "passed" if not failures and duplicate_side_effects == 0 else "failed",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return 0 if evidence["result"] == "passed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
