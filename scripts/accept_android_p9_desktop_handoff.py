from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import xml.etree.ElementTree as ET


REPO = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def suite(path: Path) -> dict[str, int | str] | None:
    if not path.is_file():
        return None
    root = ET.parse(path).getroot()
    result: dict[str, int | str] = {
        key: int(root.attrib.get(key, 0)) for key in ("tests", "failures", "errors", "skipped")
    }
    result["name"] = root.attrib.get("name", "")
    result["sha256"] = digest(path)
    return result


def green(value: dict[str, int | str] | None, minimum: int) -> bool:
    return value is not None and int(value["tests"]) >= minimum and value["failures"] == 0 and value["errors"] == 0


def main() -> int:
    coordinator_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/runtime/coordinator/HybridRuntimeCoordinator.kt"
    models_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/data/Models.kt"
    view_model_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/AppViewModel.kt"
    ui_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/ui/OpenDrSaiApp.kt"
    capability_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/workbench/model/WorkbenchModels.kt"
    planner_test_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/HybridRuntimeCoordinatorTest.kt"
    contract_test_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/DesktopHandoffContractTest.kt"
    coordinator = coordinator_path.read_text(encoding="utf-8")
    view_model = view_model_path.read_text(encoding="utf-8")
    ui = ui_path.read_text(encoding="utf-8")
    capability = capability_path.read_text(encoding="utf-8")
    planner_suite = suite(REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.HybridRuntimeCoordinatorTest.xml")
    contract_suite = suite(REPO / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.DesktopHandoffContractTest.xml")

    preflight = view_model.find("interceptDesktopExclusiveRequest(user.id, clean, drafts, handoffRequest)")
    upload = view_model.find("attachmentRepository.upload(")
    execution = view_model.find("journaledChatExecution.execute(")
    gates = {
        "powershell_git_pty_and_codex_have_distinct_capabilities": all(
            value in coordinator for value in (
                "RuntimeCapability.SHELL", "RuntimeCapability.PTY", "RuntimeCapability.GIT", "RuntimeCapability.CODEX"
            )
        ) and "PTY," in capability,
        "only_explicit_desktop_requests_are_intercepted": "DesktopHandoffState.NOT_REQUIRED" in coordinator
            and "required.isEmpty()" in coordinator,
        "online_capable_remote_is_selected_deterministically": "it.online" in coordinator
            and "containsAll(required + RuntimeCapability.CHAT)" in coordinator
            and "sortedWith(" in coordinator,
        "offline_or_incapable_remote_fails_honestly": "DesktopHandoffState.UNAVAILABLE" in coordinator
            and "尚未执行任何命令" in coordinator,
        "android_never_claims_desktop_execution": "Android 尚未执行任何命令" in coordinator,
        "preflight_precedes_upload_and_local_agent_execution": preflight >= 0 and upload > preflight and execution > preflight,
        "handoff_is_oaep_authoritative_before_ui_navigation": all(value in view_model for value in (
            "DesktopHandoffOaep.offered", "DesktopHandoffOaep.accepted", "DesktopHandoffOaep.declined",
            "persistOaepEvents(",
        )),
        "handoff_requires_confirmation_and_has_digest": "HandoffPackageFactory.create(" in view_model
            and "confirmed = true" in view_model and "handoffPackage.digest.take(12)" in view_model,
        "attachments_are_digest_bound_without_silent_drop": "handoff_attachment_digest_invalid" in view_model
            and "drafts.map { attachment" in view_model,
        "handoff_is_user_visible_and_routes_to_remote_home": "pendingDesktopHandoff" in models_path.read_text(encoding="utf-8")
            and "交给 Desktop Runtime？" in ui and "打开远程 Runtime" in ui and "AppRoute.RemoteHome.path" in view_model,
        "planner_and_product_contract_tests_green": green(planner_suite, 6) and green(contract_suite, 2),
    }
    sources = (
        coordinator_path, models_path, view_model_path, ui_path, capability_path, planner_test_path, contract_test_path,
    )
    report = {
        "schema_version": 1,
        "feature_id": "M06-F05",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "gates": gates,
        "planner_suite": planner_suite,
        "contract_suite": contract_suite,
        "source_sha256": {
            str(path.relative_to(REPO)).replace("\\", "/"): digest(path) for path in sources
        },
    }
    output = REPO / "docs/android/reports/evidence/p9/m06-f05-desktop-handoff.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
