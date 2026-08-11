from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET


REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "cores/python/packages/drsai/src"))

from drsai.backend.runtime.mobile_core import MessageType, RuntimeEnvelope, create_mobile_agent_core  # noqa: E402


def envelope(kind: MessageType, sequence: int, payload: dict, key: str) -> RuntimeEnvelope:
    return RuntimeEnvelope(kind, f"request-{sequence}", "run-context", "session-context", sequence, key, payload)


def tool() -> dict:
    return {
        "name": "clock", "version": 1, "source": "android-host", "classification": "local-equivalent",
        "description": "clock", "parameters": {"type": "object", "properties": {}},
        "required_capabilities": [], "risk": "read_only", "requires_approval": False,
    }


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    first = create_mobile_agent_core()
    first.handle(envelope(MessageType.START_RUN, 0, {
        "input": "check", "model_id": "model", "tools": [tool()],
    }, "start"))
    first.handle(envelope(MessageType.MODEL_COMPLETED, 1, {
        "tool_calls": [{"call_id": "call-1", "name": "clock", "arguments": {}}],
    }, "model-1"))
    outputs = first.handle(envelope(MessageType.TOOL_RESULT, 2, {
        "call_id": "call-1", "succeeded": True, "content": {"time": "10:00"},
    }, "tool-1"))
    before = next(value for value in outputs if value.message_type is MessageType.MODEL_REQUEST)
    checkpoint = next(value for value in outputs if value.message_type is MessageType.CHECKPOINT_REQUEST)

    second = create_mobile_agent_core()
    resumed = second.handle(envelope(MessageType.RESUME_RUN, 3, {"state": checkpoint.payload["state"]}, "resume"))
    after = next(value for value in resumed if value.message_type is MessageType.MODEL_REQUEST)

    result_dir = REPO / "apps/android/app/build/outputs/androidTest-results/connected/debug"
    xml_files = sorted(result_dir.glob("TEST-*.xml"), key=lambda value: value.stat().st_mtime, reverse=True)
    instrumentation = None
    if xml_files:
        suite = ET.parse(xml_files[0]).getroot()
        cases = [value.attrib.get("name") for value in suite.findall("testcase")]
        instrumentation = {
            "suite": suite.attrib.get("name"), "tests": int(suite.attrib.get("tests", 0)),
            "failures": int(suite.attrib.get("failures", 0)), "errors": int(suite.attrib.get("errors", 0)),
            "cases": cases, "result_sha256": digest(xml_files[0]),
        }
    gates = {
        "messages_identical_after_restart": before.payload["messages"] == after.payload["messages"],
        "semantic_digest_identical_after_restart": before.payload["conversation_context"] == after.payload["conversation_context"],
        "assistant_tool_result_pair_complete": before.payload["conversation_context"]["tool_call_count"] == 1
        and before.payload["conversation_context"]["tool_result_count"] == 1
        and before.payload["conversation_context"]["pending_tool_call_count"] == 0,
        "checkpoint_binds_context_digest": checkpoint.payload["state"]["conversation_context"]["sha256"]
        == before.payload["conversation_context"]["sha256"],
        "android_process_restart_instrumentation_passed": instrumentation is not None
        and instrumentation["tests"] == 1 and instrumentation["failures"] == 0 and instrumentation["errors"] == 0
        and "checkpointRestoresIdenticalConversationAfterRuntimeProcessRestart" in instrumentation["cases"],
    }
    sources = (
        "cores/python/packages/drsai/src/drsai/backend/runtime/agent_kernel.py",
        "cores/python/packages/drsai/src/drsai/backend/runtime/mobile_core/engine.py",
        "cores/python/packages/drsai/tests/test_mobile_agent_core.py",
        "apps/android/app/src/androidTest/java/ai/drsai/remote/PythonRuntimeServiceTest.kt",
    )
    report = {
        "schema_version": 1, "feature_id": "M03-F01",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()), "gates": gates,
        "conversation_context": before.payload["conversation_context"],
        "instrumentation": instrumentation,
        "source_sha256": {relative: digest(REPO / relative) for relative in sources},
    }
    output = REPO / "docs/android/reports/evidence/p9/m03-f01-short-term-context.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
