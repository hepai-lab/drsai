from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess
import sys
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
    route_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/data/PinnedModelRoute.kt"
    client_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/data/HaiModelClient.kt"
    engine_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/PythonSharedCoreChatEngine.kt"
    host_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/python/AndroidPythonHostAdapters.kt"
    kernel_path = REPO / "cores/python/packages/drsai/src/drsai/backend/runtime/agent_kernel.py"
    mobile_path = REPO / "cores/python/packages/drsai/src/drsai/backend/runtime/mobile_core/engine.py"
    route_test_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/PinnedModelRouteTest.kt"
    client_test_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/HaiModelClientTest.kt"
    python_test_path = REPO / "cores/python/packages/drsai/tests/test_model_route_snapshot.py"
    sources = (route_path, client_path, engine_path, host_path, kernel_path, mobile_path, route_test_path, client_test_path, python_test_path)
    text = {path: path.read_text(encoding="utf-8") for path in sources}

    pytest = subprocess.run(
        [sys.executable, "-m", "pytest", "-q", str(python_test_path.relative_to(REPO))],
        cwd=REPO, capture_output=True, text=True, timeout=60, check=False,
    )
    paths = [
        REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.PinnedModelRouteTest.xml",
        REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.HaiModelClientTest.xml",
        REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.AndroidPythonHostAdaptersTest.xml",
    ]
    suites = [suite(path) for path in paths if path.exists()]
    tests = sum(item["tests"] for item in suites)
    failures = sum(item["failures"] for item in suites)
    errors = sum(item["errors"] for item in suites)
    skipped = sum(item["skipped"] for item in suites)

    route = text[route_path]
    client = text[client_path]
    engine = text[engine_path]
    host = text[host_path]
    kernel = text[kernel_path]
    mobile = text[mobile_path]
    client_test = text[client_test_path]
    python_test = text[python_test_path]
    gates = {
        "versioned_nonsecret_route_snapshot_has_digest": "p9-model-route-v1" in route and "credential_kind" in route and "sha256" in route,
        "new_run_pins_route_before_start_envelope": "pinModelRoute(modelId)" in engine and '.put("model_route_snapshot", modelRouteSnapshot)' in engine,
        "active_run_ignores_later_default_or_upstream_change": "pinnedRunKeepsOriginalUpstreamModelAfterConfiguredDefaultChanges" in client_test and "vendor/original" in client_test,
        "checkpoint_persists_route_and_resume_reuses_it": '"model_route_snapshot": dict(state.model_route_snapshot)' in mobile and "model_route_is_pinned_into_model_request_and_checkpoint_resume" in python_test,
        "resume_uses_checkpoint_model_not_current_conversation_default": 'existingCheckpoint!!.state.optString("model_id")' in engine and 'resumed_request.payload["model_id"] == "stable-model"' in python_test,
        "host_uses_pinned_route_without_dynamic_reresolution": "streamCompletionWithPinnedRoute" in host and "validatedRoute" in client,
        "provider_deletion_or_missing_key_fails_explicitly": "model_provider_credentials_missing" in client and "deletedProviderCredentialFailsExplicitlyInsteadOfFallingBackToHepai" in client_test,
        "route_tampering_and_model_switch_fail_closed": "model_route_snapshot_digest_invalid" in kernel and "model_route_tamper_and_model_switch_fail_closed" in python_test,
        "legacy_missing_route_is_nonfunctional_not_silent_provider_fallback": "https://invalid.local" in kernel and "https://invalid.local" in engine,
        "python_and_android_focused_suites_are_green": pytest.returncode == 0 and len(suites) == 3 and tests >= 25 and failures == errors == skipped == 0,
    }
    report = {
        "schema_version": 1,
        "feature_id": "M09-F05",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "gates": gates,
        "pytest": {"returncode": pytest.returncode, "summary": "\n".join(pytest.stdout.strip().splitlines()[-3:])},
        "jvm_suites": {"tests": tests, "failures": failures, "errors": errors, "skipped": skipped, "reports": suites},
        "source_sha256": {str(path.relative_to(REPO)).replace("\\", "/"): digest(path) for path in sources},
    }
    output = REPO / "docs/android/reports/evidence/p9/m09-f05-pinned-model-route.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates), "jvm_tests": tests}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
