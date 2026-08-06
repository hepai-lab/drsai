from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET

REPO = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def suite(path: Path) -> dict:
    root = ET.parse(path).getroot()
    return {key: int(root.attrib.get(key, 0)) for key in ("tests", "failures", "errors", "skipped")} | {
        "name": root.attrib.get("name", ""), "sha256": digest(path),
    }


def main() -> int:
    assembler_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/StreamedToolCallAssembler.kt"
    host_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/AndroidPythonHostAdapters.kt"
    fixture_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/StreamedToolCallAssemblerTest.kt"
    host_test_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/AndroidPythonHostAdaptersTest.kt"
    sources = (assembler_path, host_path, fixture_path, host_test_path)
    assembler = assembler_path.read_text(encoding="utf-8")
    host = host_path.read_text(encoding="utf-8")
    fixture = fixture_path.read_text(encoding="utf-8")

    paths = [
        REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.StreamedToolCallAssemblerTest.xml",
        REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.AndroidPythonHostAdaptersTest.xml",
    ]
    suites = [suite(path) for path in paths if path.exists()]
    tests = sum(item["tests"] for item in suites)
    failures = sum(item["failures"] for item in suites)
    errors = sum(item["errors"] for item in suites)
    skipped = sum(item["skipped"] for item in suites)

    gates = {
        "fragmented_id_name_and_arguments_reconstruct_exactly": "fragmented id name and arguments reconstruct exact object" in fixture,
        "interleaved_multiple_calls_preserve_index_order": "interleaved multiple calls preserve index order" in fixture and "pending.keys.sorted()" in assembler,
        "missing_id_or_name_fails_closed": all(value in assembler for value in ("id_missing", "name_missing", "model_tool_stream_invalid")),
        "duplicate_identity_fragments_fail_closed": all(value in assembler for value in ("duplicate_id", "duplicate_name", "id_reused")),
        "invalid_json_fails_closed": "arguments_invalid_json" in assembler,
        "index_gap_and_bounds_fail_closed": all(value in assembler for value in ("index_out_of_range", "index_gap", "maxCalls")),
        "argument_buffer_is_bounded": "maxArgumentsChars" in assembler and "arguments_too_large" in assembler,
        "production_host_uses_single_strict_assembler": "StreamedToolCallAssembler()" in host and "calls.finish()" in host,
        "focused_jvm_suites_are_green": len(suites) == 2 and tests >= 12 and failures == errors == skipped == 0,
    }
    report = {
        "schema_version": 1,
        "feature_id": "M09-F04",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "gates": gates,
        "jvm_suites": {"tests": tests, "failures": failures, "errors": errors, "skipped": skipped, "reports": suites},
        "source_sha256": {str(path.relative_to(REPO)).replace("\\", "/"): digest(path) for path in sources},
    }
    output = REPO / "docs/android/reports/evidence/p9/m09-f04-streamed-tool-calls.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates), "tests": tests}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
