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


def main() -> int:
    access_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/data/LocalArtifactAccess.kt"
    downloader_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/remote/data/ArtifactDownload.kt"
    file_paths_path = REPO / "apps/android/app/src/main/res/xml/file_paths.xml"
    ui_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/ui/OpenDrSaiApp.kt"
    vm_path = REPO / "apps/android/app/src/main/java/ai/drsai/remote/AppViewModel.kt"
    policy_test_path = REPO / "apps/android/app/src/test/java/ai/drsai/remote/LocalArtifactPolicyTest.kt"
    device_test_path = REPO / "apps/android/app/src/androidTest/java/ai/drsai/remote/LocalArtifactAccessInstrumentedTest.kt"
    access = access_path.read_text(encoding="utf-8")
    downloader = downloader_path.read_text(encoding="utf-8")
    file_paths = file_paths_path.read_text(encoding="utf-8")
    ui = ui_path.read_text(encoding="utf-8")
    vm = vm_path.read_text(encoding="utf-8")
    jvm = {
        name: suite(REPO / f"apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.{name}.xml")
        for name in ("LocalArtifactPolicyTest", "ArtifactDownloaderTest", "AndroidPythonHostAdaptersTest")
    }
    connected_files = sorted(
        (REPO / "apps/android/app/build/outputs/androidTest-results/connected/debug").glob("**/TEST-*.xml"),
        key=lambda value: value.stat().st_mtime, reverse=True,
    )
    connected_path = next((path for path in connected_files if "LocalArtifactAccessInstrumentedTest" in path.read_text(encoding="utf-8")), None)
    connected = suite(connected_path) if connected_path else None
    gates = {
        "text_image_pdf_and_large_preview_policy": all(
            value in access for value in ("ArtifactPreviewKind.TEXT", "ArtifactPreviewKind.IMAGE", "ArtifactPreviewKind.PDF", "ArtifactPreviewKind.TOO_LARGE")
        ),
        "artifact_size_digest_and_scope_are_verified": all(
            value in access for value in ("artifact_size_mismatch", "artifact_digest_mismatch", "artifact_not_found", "MAX_OPEN_BYTES")
        ),
        "large_remote_artifacts_are_chunked_and_digest_checked": all(
            value in downloader for value in ("chunkSize", "artifact_digest_mismatch", "artifact_scope_mismatch", "artifact_size_limit")
        ),
        "process_recovery_rebuilds_from_durable_metadata": "Recreates a verified app-private artifact after process restart" in access
            and "LocalArtifactMaterializer" in vm,
        "preview_and_share_are_user_visible": "onOpen" in ui and "onShare" in ui and "openWorkbenchArtifact" in vm,
        "sharing_uses_scoped_read_only_file_provider": all(
            value in access for value in ("FileProvider.getUriForFile", "FLAG_GRANT_READ_URI_PERMISSION", "ClipData.newUri")
        ) and "workbench/artifacts/" in file_paths and "FLAG_GRANT_WRITE_URI_PERMISSION" not in access,
        "artifact_descriptors_never_export_storage_paths": "LocalArtifactHandle" in access
            and "internal val file" in access and "absolutePath" not in access,
        "jvm_artifact_suites_green": all(
            value is not None and value["failures"] == 0 and value["errors"] == 0 for value in jvm.values()
        ),
        "api35_file_provider_recovery_suite_green": connected is not None
            and connected["name"] == "ai.drsai.remote.LocalArtifactAccessInstrumentedTest"
            and connected["tests"] == 2 and connected["failures"] == 0 and connected["errors"] == 0,
    }
    sources = (access_path, downloader_path, file_paths_path, ui_path, vm_path, policy_test_path, device_test_path)
    report = {
        "schema_version": 1,
        "feature_id": "M06-F03",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "gates": gates,
        "jvm_suites": jvm,
        "connected_suite": connected,
        "connected_report": None if connected_path is None else str(connected_path.relative_to(REPO)).replace("\\", "/"),
        "source_sha256": {str(path.relative_to(REPO)).replace("\\", "/"): digest(path) for path in sources},
    }
    output = REPO / "docs/android/reports/evidence/p9/m06-f03-local-artifacts.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
