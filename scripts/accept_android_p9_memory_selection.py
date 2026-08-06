from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET


REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "cores/python/packages/drsai/src"))

from drsai.backend.runtime.agent_kernel import select_relevant_memories  # noqa: E402


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def android_suite(name: str) -> dict | None:
    path = REPO / f"apps/android/app/build/test-results/testDebugUnitTest/TEST-{name}.xml"
    if not path.is_file():
        return None
    root = ET.parse(path).getroot()
    return {
        "tests": int(root.attrib.get("tests", 0)),
        "failures": int(root.attrib.get("failures", 0)),
        "errors": int(root.attrib.get("errors", 0)),
        "sha256": digest(path),
    }


def main() -> int:
    fixture_path = REPO / "cores/protocol/android-runtime/fixtures/p9-memory-selection-v1.json"
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    expected_total = selected_total = true_positive = 0
    adversarial_rejected = sensitive_rejected = True
    deterministic = True
    for case in fixture["cases"]:
        result = select_relevant_memories(case["query"], case["candidates"])
        selected = [item["id"] for item in result["selected"]]
        expected = case["expected"]
        expected_total += len(expected)
        selected_total += len(selected)
        true_positive += len(set(selected).intersection(expected))
        omitted = {item["id"]: item["reason"] for item in result["omitted"]}
        adversarial_rejected = adversarial_rejected and all(
            omitted.get(key) == value for key, value in case.get("expected_omitted", {}).items()
            if value == "adversarial_instruction"
        )
        sensitive_rejected = sensitive_rejected and all(
            omitted.get(key) == value for key, value in case.get("expected_omitted", {}).items()
            if value == "sensitive"
        )
        deterministic = deterministic and result == select_relevant_memories(case["query"], list(case["candidates"]))
    recall = true_positive / expected_total
    precision = true_positive / selected_total
    candidate_tests = android_suite("ai.drsai.remote.MemoryCandidateEnvelopeTest")
    mapper_tests = android_suite("ai.drsai.remote.PythonRuntimeEventMapperTest")
    desktop_source = (REPO / "cores/python/packages/drsai/src/drsai/backend/runtime/desktop_agent_kernel_adapter.py").read_text(encoding="utf-8")
    gates = {
        "frozen_dataset_recall_threshold": recall >= float(fixture["minimum_recall"]),
        "frozen_dataset_precision_threshold": precision >= float(fixture["minimum_precision"]),
        "adversarial_memory_rejected": adversarial_rejected,
        "sensitive_memory_rejected": sensitive_rejected,
        "selection_and_digest_deterministic": deterministic,
        "desktop_curated_memory_uses_shared_selection": "memory_candidates=_desktop_memory_candidates(agent)" in desktop_source,
        "android_subject_candidate_gate_passed": candidate_tests is not None and candidate_tests["tests"] == 3 and candidate_tests["failures"] == 0 and candidate_tests["errors"] == 0,
        "android_oaep_provenance_gate_passed": mapper_tests is not None and mapper_tests["failures"] == 0 and mapper_tests["errors"] == 0,
    }
    sources = (
        "cores/python/packages/drsai/src/drsai/backend/runtime/agent_kernel.py",
        "cores/python/packages/drsai/src/drsai/backend/runtime/mobile_core/engine.py",
        "cores/python/packages/drsai/src/drsai/backend/runtime/desktop_agent_kernel_adapter.py",
        "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/PythonSharedCoreChatEngine.kt",
        "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/PythonRuntimeEventMapper.kt",
        "apps/android/app/src/test/java/ai/drsai/remote/MemoryCandidateEnvelopeTest.kt",
        "cores/python/packages/drsai/tests/test_memory_selection.py",
        "cores/python/packages/drsai/tests/test_memory_selection_dataset.py",
        "cores/protocol/android-runtime/fixtures/p9-memory-selection-v1.json",
    )
    report = {
        "schema_version": 1,
        "feature_id": "M03-F03",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "gates": gates,
        "dataset": {"cases": len(fixture["cases"]), "recall": recall, "precision": precision, "sha256": digest(fixture_path)},
        "android": {"candidate_tests": candidate_tests, "mapper_tests": mapper_tests},
        "source_sha256": {relative: digest(REPO / relative) for relative in sources},
    }
    output = REPO / "docs/android/reports/evidence/p9/m03-f03-memory-selection.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates), "recall": recall, "precision": precision}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
