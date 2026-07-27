from __future__ import annotations

import importlib.util
import hashlib
import json
import sys
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[5]
SCRIPT = ROOT / "scripts/finalize_mobile_remote_workspace_release_v2.py"
sys.path.insert(0, str(ROOT / "scripts"))
SPEC = importlib.util.spec_from_file_location("release_finalizer", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)
CATALOG_SCREENSHOT = ROOT / "release/product-evidence/mobile-remote-workspace-v2/test-catalog.png"
INTERACTION_SCREENSHOT = ROOT / "release/product-evidence/mobile-remote-workspace-v2/test-interaction.png"


@pytest.fixture(autouse=True)
def clean_test_screenshots():
    yield
    CATALOG_SCREENSHOT.unlink(missing_ok=True)
    INTERACTION_SCREENSHOT.unlink(missing_ok=True)


def reports(tmp_path: Path) -> tuple[Path, Path, Path, Path, Path, Path]:
    png = b"\x89PNG\r\n\x1a\nrelease-proof"
    catalog_screenshot = CATALOG_SCREENSHOT
    interaction_screenshot = INTERACTION_SCREENSHOT
    catalog_screenshot.parent.mkdir(parents=True, exist_ok=True)
    catalog_screenshot.write_bytes(png)
    interaction_screenshot.write_bytes(png)
    screenshot_hash = hashlib.sha256(png).hexdigest()
    anonymous = {
        "passed": True,
        "authenticated": False,
        "checks": [
            {"name": name, "status": "passed"}
            for name in sorted(MODULE.REQUIRED_ANONYMOUS_CHECKS)
        ],
    }
    real_checks = [
        {"name": name, "status": "passed"}
        for name in sorted(MODULE.REQUIRED_REAL_CHECKS)
    ]
    by_name = {row["name"]: row for row in real_checks}
    by_name["pre_pair_invisible"].update(target_visible=False)
    by_name["offline_fail_closed"].update(
        phase="offline",
        network_failure=True,
        error_class="UnknownHostException",
    )
    by_name["revocation_invisible"].update(
        target_visible=False,
        workspace_proxy_status=403,
        conversation_proxy_status=403,
    )
    by_name["pair_and_catalog"].update(
        target_visible=True,
        runtime_status="online",
        directory_ui_visible=True,
        authenticated_opaque_pagination=True,
        tampered_cursor_rejected=True,
        workspace_lifecycles=["active"],
        runtime_authoritative_lifecycle_counts={
            "active": 2,
            "archived": 1,
            "removed": 1,
        },
        screenshot_artifact=str(catalog_screenshot.relative_to(ROOT)).replace("\\", "/"),
        screenshot_sha256=screenshot_hash,
    )
    by_name["message_stream_approval"].update(
        terminal_status="completed",
        approval_status="approved",
        session_ui_visible=True,
        sse_event_count=4,
        conversation_before=0,
        conversation_after=8,
        conversation_sha256="d" * 64,
        screenshot_artifact=str(interaction_screenshot.relative_to(ROOT)).replace("\\", "/"),
        screenshot_sha256=screenshot_hash,
    )
    for name in (
        "background_recovery",
        "process_death_recovery",
        "network_recovery",
        "runtime_restart_recovery",
        "repair_association",
    ):
        by_name[name].update(target_visible=True)
    by_name["relay_fault_recovery"].update(
        target_visible=True,
        event_replay_preserved=True,
        single_run_preserved=True,
        event_count_preserved=True,
        event_hash_preserved=True,
        conversation_projection_preserved=True,
        scheduled_generation=7,
        required_generation=8,
        recovered_generation=8,
    )
    real = {"passed": True, "checks": real_checks}
    stability = {
        "passed": True,
        "required_duration_seconds": 3600,
        "observed_duration_seconds": 3601,
        "probe_error_count": 0,
        "transcript_hash_stable": True,
        "android_pid_unique_count": 1,
    }
    paths = tuple(tmp_path / name for name in ("anonymous.json", "real.json", "stability.json"))
    for path, value in zip(paths, (anonymous, real, stability)):
        path.write_text(json.dumps(value), encoding="utf-8")
    apk = tmp_path / "app.apk"
    apk.write_bytes(b"android-apk")
    python_junit = tmp_path / "python-junit.xml"
    android_junit = tmp_path / "android-junit.xml"
    python_junit.write_text(
        "<testsuite>" + "".join(
            f'<testcase name="python-{index}"/>' for index in range(500)
        ) + "</testsuite>",
        encoding="utf-8",
    )
    android_junit.write_text(
        "<testsuite>" + "".join(
            f'<testcase name="android-{index}"/>' for index in range(200)
        ) + "</testsuite>",
        encoding="utf-8",
    )
    return (*paths, apk, python_junit, android_junit)


def test_finalizer_promotes_all_80_only_with_complete_real_evidence(tmp_path: Path) -> None:
    anonymous, real, stability, apk, python_junit, android_junit = reports(tmp_path)
    result = MODULE.finalize(
        MODULE.acceptance.LEDGER,
        anonymous,
        real,
        stability,
        apk,
        python_junit,
        android_junit,
        hai_revision="a" * 40,
        windows_revision="b" * 40,
        android_revision="c" * 40,
    )
    assert len(result["items"]) == 80
    assert all(item["status"] == "full_pass" for item in result["items"])
    assert all(
        MODULE.acceptance.REQUIRED_FULL_EVIDENCE
        <= {row["kind"] for row in item["evidence"]}
        for item in result["items"]
    )
    release_evidence = next(
        item["evidence"] for item in result["items"] if item["id"] == "M10-F08"
    )
    assert sum(
        row.get("kind") == "automated_test" and row.get("artifact")
        in {
            str(python_junit).replace("\\", "/"),
            str(android_junit).replace("\\", "/"),
        }
        for row in release_evidence
    ) == 2
    assert MODULE.acceptance.validate(result) == []


@pytest.mark.parametrize(
    ("mutation", "error"),
    [
        (lambda real, stability: real["checks"].pop(), "release_real_checks_missing"),
        (
            lambda real, stability: real["checks"][
                next(i for i, row in enumerate(real["checks"]) if row["name"] == "message_stream_approval")
            ].update(sse_event_count=0),
            "release_interaction_evidence_invalid",
        ),
        (
            lambda real, stability: stability.update(observed_duration_seconds=3599),
            "release_stability_observation_short",
        ),
        (
            lambda real, stability: real["checks"][
                next(i for i, row in enumerate(real["checks"]) if row["name"] == "pair_and_catalog")
            ].update(screenshot_sha256="0" * 64),
            "release_catalog_screenshot_hash_mismatch",
        ),
        (
            lambda real, stability: real["checks"][
                next(i for i, row in enumerate(real["checks"]) if row["name"] == "pair_and_catalog")
            ].update(runtime_authoritative_lifecycle_counts={
                "active": 2,
                "archived": 0,
                "removed": 1,
            }),
            "release_authenticated_catalog_evidence_invalid",
        ),
        (
            lambda real, stability: real["checks"][
                next(i for i, row in enumerate(real["checks"]) if row["name"] == "relay_fault_recovery")
            ].update(event_hash_preserved=False),
            "release_relay_fault_evidence_invalid",
        ),
    ],
)
def test_finalizer_fails_closed_on_missing_or_weak_evidence(
    tmp_path: Path,
    mutation,
    error: str,
) -> None:
    anonymous, real_path, stability_path, apk, python_junit, android_junit = reports(tmp_path)
    real = json.loads(real_path.read_text())
    stability = json.loads(stability_path.read_text())
    mutation(real, stability)
    real_path.write_text(json.dumps(real))
    stability_path.write_text(json.dumps(stability))
    with pytest.raises(RuntimeError, match=error):
        MODULE.finalize(
            MODULE.acceptance.LEDGER,
            anonymous,
            real_path,
            stability_path,
            apk,
            python_junit,
            android_junit,
            hai_revision="a" * 40,
            windows_revision="b" * 40,
            android_revision="c" * 40,
        )


def test_finalizer_rejects_failed_or_missing_junit_evidence(tmp_path: Path) -> None:
    anonymous, real, stability, apk, python_junit, android_junit = reports(tmp_path)
    python_junit.write_text(
        '<testsuite><testcase name="failure"><failure/></testcase></testsuite>',
        encoding="utf-8",
    )
    with pytest.raises(RuntimeError, match="release_python_junit_failed"):
        MODULE.finalize(
            MODULE.acceptance.LEDGER,
            anonymous,
            real,
            stability,
            apk,
            python_junit,
            android_junit,
            hai_revision="a" * 40,
            windows_revision="b" * 40,
            android_revision="c" * 40,
        )
    python_junit.unlink()
    with pytest.raises(RuntimeError, match="release_python_junit_missing"):
        MODULE.finalize(
            MODULE.acceptance.LEDGER,
            anonymous,
            real,
            stability,
            apk,
            python_junit,
            android_junit,
            hai_revision="a" * 40,
            windows_revision="b" * 40,
            android_revision="c" * 40,
        )
