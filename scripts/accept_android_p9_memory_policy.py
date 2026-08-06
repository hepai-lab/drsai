from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
import xml.etree.ElementTree as ET


REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "cores/python/packages/drsai/src"))

from drsai.backend.runtime.agent_kernel import (  # noqa: E402
    build_memory_policy,
    normalize_memory_policy,
    validate_memory_tool_call,
)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def denied(policy: dict, tool: str, arguments: dict, code: str) -> bool:
    try:
        validate_memory_tool_call(policy, tool, arguments)
    except ValueError as error:
        return str(error) == code
    return False


def main() -> int:
    neutral = build_memory_policy("Tell me about concise writing")
    save = build_memory_policy("Remember that I prefer concise answers")
    delete = build_memory_policy("Delete my saved answer preference")
    authorized = validate_memory_tool_call(save, "save_memory", {"content": "prefers concise answers"})
    android_result = REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.MemoryPolicyTest.xml"
    android = None
    if android_result.is_file():
        suite = ET.parse(android_result).getroot()
        android = {
            "tests": int(suite.attrib.get("tests", 0)),
            "failures": int(suite.attrib.get("failures", 0)),
            "errors": int(suite.attrib.get("errors", 0)),
            "cases": [case.attrib.get("name") for case in suite.findall("testcase")],
            "sha256": digest(android_result),
        }
    desktop_entry = REPO / "docs/android/reports/evidence/p9/m01-f04-desktop-production-entry.json"
    desktop_entry_passed = False
    if desktop_entry.is_file():
        desktop_entry_passed = json.loads(desktop_entry.read_text(encoding="utf-8")).get("passed") is True
    tampered = dict(save)
    tampered["enabled"] = False
    tamper_denied = False
    try:
        normalize_memory_policy(tampered)
    except ValueError as error:
        tamper_denied = str(error) == "memory_policy_digest_mismatch"
    gates = {
        "mutation_requires_explicit_user_intent": denied(neutral, "save_memory", {"content": "prefers concise answers"}, "memory_explicit_intent_required"),
        "explicit_save_is_authorized_without_content_in_receipt": authorized is not None and authorized.get("authorized") is True and "concise" not in str(authorized),
        "delete_intent_is_separate_from_save": denied(save, "memory", {"action": "remove", "old_text": "answer preference"}, "memory_explicit_intent_required") and validate_memory_tool_call(delete, "memory", {"action": "remove", "old_text": "answer preference"}) is not None,
        "sensitive_secret_is_never_persisted": denied(save, "save_memory", {"content": "api_key=super-secret"}, "memory_sensitive_content_denied"),
        "sensitive_health_data_is_never_persisted": denied(save, "save_memory", {"content": "medical diagnosis: test"}, "memory_sensitive_content_denied"),
        "disabled_memory_fails_closed": denied(build_memory_policy("Remember this", enabled=False), "save_memory", {"content": "preference"}, "memory_disabled"),
        "policy_tampering_fails_closed": tamper_denied,
        "desktop_legacy_agent_entry_is_closed": desktop_entry_passed,
        "android_subject_capability_and_host_policy_pass": android is not None and android["tests"] == 2 and android["failures"] == 0 and android["errors"] == 0 and set(android["cases"]) == {
            "sensitiveMemoryContentIsDeniedByHostDefenseInDepth",
            "memoryToolsRequireCapabilityAndUseOnlyCallingSubject",
        },
    }
    sources = (
        "cores/python/packages/drsai/src/drsai/backend/runtime/agent_kernel.py",
        "cores/python/packages/drsai/src/drsai/backend/runtime/desktop_agent_kernel_adapter.py",
        "cores/python/packages/drsai/tests/test_memory_policy.py",
        "apps/android/app/src/main/java/ai/drsai/remote/runtime/tools/ToolRegistry.kt",
        "apps/android/app/src/main/java/ai/drsai/remote/runtime/context/ContextAssembler.kt",
        "apps/android/app/src/test/java/ai/drsai/remote/MemoryPolicyTest.kt",
    )
    report = {
        "schema_version": 1,
        "feature_id": "M03-F02",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "gates": gates,
        "android": android,
        "memory_policy": {key: save[key] for key in ("policy_version", "enabled", "allowed_mutations", "sha256")},
        "source_sha256": {relative: digest(REPO / relative) for relative in sources},
    }
    output = REPO / "docs/android/reports/evidence/p9/m03-f02-memory-policy.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
