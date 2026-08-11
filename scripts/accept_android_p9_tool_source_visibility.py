from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import struct
import xml.etree.ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def green_junit(path: Path, minimum: int) -> bool:
    if not path.is_file():
        return False
    root = ET.parse(path).getroot()
    return (
        int(root.attrib.get("tests", 0)) >= minimum
        and int(root.attrib.get("failures", 0)) == 0
        and int(root.attrib.get("errors", 0)) == 0
    )


def png_size(path: Path) -> tuple[int, int] | None:
    if not path.is_file() or path.stat().st_size < 24:
        return None
    data = path.read_bytes()[:24]
    if data[:8] != b"\x89PNG\r\n\x1a\n":
        return None
    return struct.unpack(">II", data[16:24])


def main() -> int:
    presentation_path = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/remote/model/OaepPresentation.kt"
    ui_path = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/ui/OpenDrSaiApp.kt"
    projection_test_path = ROOT / "apps/android/app/src/test/java/ai/drsai/remote/OaepProjectionTest.kt"
    ui_test_path = ROOT / "apps/android/app/src/androidTest/java/ai/drsai/remote/ui/OaepToolVisibilityUiTest.kt"
    junit_path = ROOT / "apps/android/app/build/test-results/testDebugUnitTest/TEST-ai.drsai.remote.OaepProjectionTest.xml"
    device_junit_path = ROOT / "apps/android/app/build/outputs/androidTest-results/connected/debug/TEST-ai.drsai.remote.ui.OaepToolVisibilityUiTest.xml"
    emulator_shot = ROOT / "docs/android/reports/evidence/p9/screenshots/m10-f02-emulator.png"
    physical_shot = ROOT / "docs/android/reports/evidence/p9/screenshots/m10-f02-sm-x936c.png"
    presentation = presentation_path.read_text(encoding="utf-8")
    ui = ui_path.read_text(encoding="utf-8")
    projection_test = projection_test_path.read_text(encoding="utf-8")
    ui_test = ui_test_path.read_text(encoding="utf-8")
    screenshots = {"emulator": png_size(emulator_shot), "sm_x936c": png_size(physical_shot)}

    gates = {
        "oaep_citations_and_tool_receipts_keep_safe_source_links": all(value in presentation for value in (
            "content.citations.toSourceLinks()", "toolSourceLinks(content)", "toSafeSourceLink",
        )),
        "search_read_and_delegate_have_user_facing_progress": all(value in presentation for value in (
            '"正在搜索网页"', '"正在读取网页"', '"正在委派',
        )),
        "tool_mcp_subagent_and_remote_execution_locations_are_explicit": all(value in presentation for value in (
            '"Android Agent Runtime · Shared Core"', '"Android Agent Runtime · Android Host"',
            '"Android Agent Runtime → MCP', '"Remote Runtime ·', '"Subagent ·',
        )),
        "compose_renders_clickable_sources_failure_and_execution_location": all(value in ui for value in (
            "OaepSourceLinks(result.sources)", "OaepSourceLinks(item.sources)", 'Text("执行位置：$it"',
            "CustomTabsIntent.Builder().build().launchUrl", 'turn.status == "failed"',
        )),
        "projection_fixture_covers_source_failure_and_location": all(value in projection_test for value in (
            "presentation keeps tool progress execution location failures and source links",
            'assertEquals("failed", turn.process[1].status)', 'assertEquals("HEPiX source"',
        )),
        "compose_fixture_covers_visible_search_read_delegate_source_and_failure": all(value in ui_test for value in (
            'onNodeWithText("正在搜索网页")', 'onNodeWithText("正在委派 · 核验会议日期")',
            'onNodeWithText("fetch_timeout")', 'onNodeWithText("HEPiX 官方来源")',
            "captureToImage()",
        )),
        "projection_jvm_suite_is_green": green_junit(junit_path, 1),
        "physical_device_compose_suite_is_green": green_junit(device_junit_path, 1),
        "emulator_and_sm_x936c_screenshots_are_valid_and_distinct": (
            all(size and size[0] >= 480 and size[1] >= 480 for size in screenshots.values())
            and digest(emulator_shot) != digest(physical_shot)
        ),
    }
    sources = (presentation_path, ui_path, projection_test_path, ui_test_path)
    report = {
        "schema_version": 1,
        "feature_id": "M10-F02",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "passed": all(gates.values()),
        "gates": gates,
        "screenshots": {
            "emulator": {"path": str(emulator_shot.relative_to(ROOT)).replace("\\", "/"), "size": screenshots["emulator"], "sha256": digest(emulator_shot)},
            "sm_x936c": {"path": str(physical_shot.relative_to(ROOT)).replace("\\", "/"), "size": screenshots["sm_x936c"], "sha256": digest(physical_shot)},
        },
        "source_sha256": {str(path.relative_to(ROOT)).replace("\\", "/"): digest(path) for path in sources},
    }
    output = ROOT / "docs/android/reports/evidence/p9/m10-f02-tool-source-visibility.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "gates": sum(gates.values()), "total": len(gates)}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
