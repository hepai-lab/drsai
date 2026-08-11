from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET


REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "cores/python/packages/drsai/src"))

from drsai.backend.runtime.agent_kernel import assemble_agent_context, build_conversation_summary  # noqa: E402
from drsai.backend.runtime.mobile_core import MessageType, RuntimeEnvelope, create_mobile_agent_core  # noqa: E402


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def history(turns: int) -> list[dict]:
    values = [
        {"role": "user", "content": "Constraint: answers must cite verified sources."},
        {"role": "assistant", "content": "TODO pending: compare Android and Desktop behavior."},
        {"role": "assistant", "content": "", "tool_calls": [{"id": "call-verify", "name": "search", "arguments": {}}]},
        {"role": "tool", "tool_call_id": "call-verify", "name": "search", "content": "verified receipt", "succeeded": True},
    ]
    values.extend(
        {"role": "user" if index % 2 == 0 else "assistant", "content": f"ordinary turn {index} " + "x" * 120}
        for index in range(turns * 2 - len(values))
    )
    return values


def main() -> int:
    budget = {"context_window_tokens": 4_096, "reserved_output_tokens": 1_024, "max_messages": 18, "summary_tokens": 512}
    summaries = {}
    bounded = True
    for turns in (100, 500):
        messages = assemble_agent_context(history(turns), "Continue unfinished comparison", context_budget=budget)
        summaries[turns] = next(item["content"] for item in messages if "EARLIER_CONVERSATION_SUMMARY" in item["content"])
        bounded = bounded and len(messages) <= 18
    canonical = build_conversation_summary(history(500), max_chars=4_096)
    start = RuntimeEnvelope(MessageType.START_RUN, "request-start", "run-summary", "session-summary", 0, "start", {
        "input": "Continue unfinished comparison", "model_id": "fixture-model", "tools": [],
        "history": history(500), "context_budget": budget,
    })
    first = create_mobile_agent_core().handle(start)
    checkpoint = next(item for item in first if item.message_type is MessageType.CHECKPOINT_REQUEST)
    before = next(item for item in first if item.message_type is MessageType.MODEL_REQUEST)
    resumed = create_mobile_agent_core().handle(RuntimeEnvelope(
        MessageType.RESUME_RUN, "request-resume", "run-summary", "session-summary", 1, "resume",
        {"state": checkpoint.payload["state"]},
    ))
    after = next(item for item in resumed if item.message_type is MessageType.MODEL_REQUEST)
    result_dir = REPO / "apps/android/app/build/test-results/testDebugUnitTest"
    roots = [ET.parse(path).getroot() for path in result_dir.glob("TEST-*.xml")]
    android = {
        "tests": sum(int(root.attrib.get("tests", 0)) for root in roots),
        "failures": sum(int(root.attrib.get("failures", 0)) for root in roots),
        "errors": sum(int(root.attrib.get("errors", 0)) for root in roots),
    }
    gates = {
        "hundred_turn_summary_bounded": bounded and bool(summaries[100]),
        "five_hundred_turn_summary_bounded": bool(summaries[500]),
        "critical_constraint_preserved": all("answers must cite verified sources" in value for value in summaries.values()),
        "unfinished_plan_preserved": all("TODO pending" in value for value in summaries.values()),
        "tool_receipt_preserved": all("call_id=call-verify" in value and "sha256=" in value for value in summaries.values()),
        "summary_is_idempotent": build_conversation_summary([{"role": "system", "content": canonical}], max_chars=4_096) == canonical,
        "crash_resume_context_identical": before.payload["messages"] == after.payload["messages"],
        "android_full_unit_regression_passed": android["tests"] >= 446 and android["failures"] == 0 and android["errors"] == 0,
    }
    sources = (
        "cores/python/packages/drsai/src/drsai/backend/runtime/agent_kernel.py",
        "cores/python/packages/drsai/src/drsai/backend/runtime/mobile_core/engine.py",
        "cores/python/packages/drsai/tests/test_conversation_summary.py",
        "cores/python/packages/drsai/tests/test_context_budget_policy.py",
    )
    report = {
        "schema_version": 1, "feature_id": "M03-F04",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()), "gates": gates, "android": android,
        "summary_sha256": hashlib.sha256(canonical.encode()).hexdigest(),
        "source_sha256": {relative: digest(REPO / relative) for relative in sources},
    }
    output = REPO / "docs/android/reports/evidence/p9/m03-f04-conversation-summary.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
