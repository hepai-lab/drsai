from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET


REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "cores/python/packages/drsai/src"))

from drsai.backend.runtime.agent_kernel_factory import create_agent_kernel  # noqa: E402
from drsai.backend.runtime.desktop_agent_kernel_adapter import _desktop_memory_candidates  # noqa: E402
from drsai.backend.runtime.mobile_core import MessageType, RuntimeEnvelope  # noqa: E402


CONTENTS = ["I prefer concise answers in Chinese.", "My favorite color is blue."]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def candidates() -> list[dict[str, str]]:
    return [{"id": f"memory-{hashlib.sha256(content.encode()).hexdigest()[:24]}", "content": content} for content in CONTENTS]


def run(surface: str) -> tuple[list, dict]:
    output = create_agent_kernel(surface=surface).handle(RuntimeEnvelope(
        MessageType.START_RUN, f"request-{surface}", f"run-{surface}", f"session-{surface}", 0, "start",
        {"input": "How should you format my answers?", "model_id": "fixture-model", "tools": [],
         "memory_candidates": candidates(), "host_port": {
             "schema_version": 1, "protocol_version": "p9-host-port-v1", "surface": surface,
             "capabilities": [{"id": "chat", "version": 1, "required": True}],
         }},
    ))
    model = next(item for item in output if item.message_type is MessageType.MODEL_REQUEST)
    started = next(item for item in output if item.message_type is MessageType.RUNTIME_EVENT and item.payload.get("kind") == "run.started")
    return list(model.payload["messages"]), dict(started.payload["memory_selection"])


def main() -> int:
    desktop_messages, desktop_selection = run("desktop")
    android_messages, android_selection = run("android")
    store = type("Store", (), {"memory_entries": CONTENTS})()
    desktop_candidates = _desktop_memory_candidates(type("Agent", (), {"_curated_memory": store})())
    xml_path = REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.MemoryCandidateEnvelopeTest.xml"
    android_test = None
    if xml_path.is_file():
        root = ET.parse(xml_path).getroot()
        android_test = {key: int(root.attrib.get(key, 0)) for key in ("tests", "failures", "errors")}
        android_test["sha256"] = digest(xml_path)
    system = desktop_messages[0]["content"]
    gates = {
        "stable_candidate_ids_equal": desktop_candidates == candidates(),
        "normalized_selected_set_equal": desktop_selection["selected"] == android_selection["selected"],
        "selection_priority_equal": desktop_selection == android_selection,
        "final_model_context_equal": desktop_messages == android_messages,
        "memory_below_tool_policy": system.index("[TOOL_POLICY]") < system.index("[MEMORY_SUMMARY]"),
        "irrelevant_memory_absent": "favorite color" not in system,
        "android_content_id_contract_passed": android_test is not None and android_test["tests"] == 3 and android_test["failures"] == 0 and android_test["errors"] == 0,
    }
    sources = (
        "cores/python/packages/drsai/src/drsai/backend/runtime/agent_kernel.py",
        "cores/python/packages/drsai/src/drsai/backend/runtime/desktop_agent_kernel_adapter.py",
        "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/PythonSharedCoreChatEngine.kt",
        "cores/python/packages/drsai/tests/test_memory_cross_runtime_parity.py",
        "apps/android/app/src/test/java/ai/drsai/remote/MemoryCandidateEnvelopeTest.kt",
    )
    report = {
        "schema_version": 1, "feature_id": "M03-F05", "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()), "gates": gates, "android": android_test,
        "selection_sha256": desktop_selection["sha256"],
        "context_sha256": hashlib.sha256(json.dumps(desktop_messages, ensure_ascii=False, sort_keys=True).encode()).hexdigest(),
        "source_sha256": {relative: digest(REPO / relative) for relative in sources},
    }
    output = REPO / "docs/android/reports/evidence/p9/m03-f05-memory-parity.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
