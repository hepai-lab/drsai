"""Audit OAEP Stage 3 completion evidence.

This is a progress gate, not a replacement for the physical Android E2E.  It
maps the 8 modules / 46 feature points in the Stage 3 plan to the evidence that
is available locally, and keeps the real cross-device convergence work explicit.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PLAN = ROOT / "docs/protocol_issue/OAEP_第三阶段真实链路收敛开发方案.md"
READINESS_SCRIPT = ROOT / "scripts/verify_oaep_stage3_e2e_readiness.py"
DEFAULT_REAL_REPORT = ROOT / "release/product-evidence/mobile-remote-workspace-v4/real-device-oaep-e2e.json"
DIGEST = re.compile(r"^[0-9a-f]{64}$")
REQUIRED_STAGE3_REAL_CHECKS = {
    "pair_and_catalog",
    "two_device_isolation",
    "windows_to_android_two_runs",
    "android_to_windows_two_runs",
    "oaep_hash_convergence",
    "approval_single_decision",
    "file_change_safe_paths",
    "revocation_stream_closed",
}
PHYSICAL_FEATURE_IDS = {
    "M02-F04",
    "M02-F06",
    "M05-F02",
    "M06-F01",
    "M06-F02",
    "M06-F03",
    "M06-F04",
    "M06-F05",
    "M07-F04",
}


def _load_readiness_module() -> Any:
    spec = importlib.util.spec_from_file_location("oaep_stage3_readiness", READINESS_SCRIPT)
    if spec is None or spec.loader is None:
        raise RuntimeError("stage3_readiness_script_unloadable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


FEATURES: list[dict[str, Any]] = [
    {"id": "M01-F01", "module": "M01", "title": "开发版 Runtime 启动核验", "status": "passed_local", "evidence": ["verify:gateway-smoke"]},
    {"id": "M01-F02", "module": "M01", "title": "OAEP 能力探测", "status": "passed_local", "evidence": ["verify:oaep-release"]},
    {"id": "M01-F03", "module": "M01", "title": "文本 streaming", "status": "passed_local", "evidence": ["verify:chat-output", "verify:oaep-runtime-contract"]},
    {"id": "M01-F04", "module": "M01", "title": "工具/命令显示", "status": "passed_local", "evidence": ["verify:oaep-runtime-contract"]},
    {"id": "M01-F05", "module": "M01", "title": "失败/取消提示", "status": "passed_local", "evidence": ["verify:oaep-runtime-contract", "verify:chat-output"]},
    {"id": "M01-F06", "module": "M01", "title": "刷新恢复", "status": "passed_local", "evidence": ["verify:session-conversation-subscription"]},
    {"id": "M01-F07", "module": "M01", "title": "调试入口", "status": "passed_local", "evidence": ["verify:oaep-runtime-contract"]},
    {"id": "M02-F01", "module": "M02", "title": "远程 session snapshot", "status": "passed_local", "evidence": ["Android unit tests", "emulator instrumentation"]},
    {"id": "M02-F02", "module": "M02", "title": "远程 event stream", "status": "passed_local", "evidence": ["RelayRemoteRepositoryTest", "RelaySseClientTest"]},
    {"id": "M02-F03", "module": "M02", "title": "Room replace/replay", "status": "passed_local", "evidence": ["RemoteSessionSyncStoreTest"]},
    {"id": "M02-F04", "module": "M02", "title": "streaming UI", "status": "needs_physical_e2e", "evidence": ["RealRemoteWorkspaceE2ETest"]},
    {"id": "M02-F05", "module": "M02", "title": "工具/审批/文件展示", "status": "passed_local", "evidence": ["OaepProjectionTest"]},
    {"id": "M02-F06", "module": "M02", "title": "断线恢复", "status": "needs_physical_e2e", "evidence": ["RealRemoteWorkspaceE2ETest"]},
    {"id": "M03-F01", "module": "M03", "title": "文本-only 投影", "status": "passed_local", "evidence": ["test_oaep_protocol.py"]},
    {"id": "M03-F02", "module": "M03", "title": "旧接口 session 绑定", "status": "passed_local", "evidence": ["test_gateway_session_events.py"]},
    {"id": "M03-F03", "module": "M03", "title": "无 session 的兼容路径", "status": "passed_local", "evidence": ["test_relay_api.py"]},
    {"id": "M03-F04", "module": "M03", "title": "工具语义不下沉", "status": "passed_local", "evidence": ["test_oaep_protocol.py"]},
    {"id": "M03-F05", "module": "M03", "title": "回归兼容", "status": "passed_local", "evidence": ["verify:chat-output"]},
    {"id": "M04-F01", "module": "M04", "title": "事件字段清单", "status": "passed_local", "evidence": ["test_codex_event_mapper.py"]},
    {"id": "M04-F02", "module": "M04", "title": "item_id 稳定性", "status": "passed_local", "evidence": ["test_normalized_agent_events.py"]},
    {"id": "M04-F03", "module": "M04", "title": "phase/status 统一", "status": "passed_local", "evidence": ["test_normalized_agent_events.py"]},
    {"id": "M04-F04", "module": "M04", "title": "command stream", "status": "passed_local", "evidence": ["test_codex_event_mapper.py"]},
    {"id": "M04-F05", "module": "M04", "title": "artifact metadata", "status": "passed_local", "evidence": ["test_runtime_conversation_journal.py"]},
    {"id": "M04-F06", "module": "M04", "title": "error envelope", "status": "passed_local", "evidence": ["test_gateway_session_events.py"]},
    {"id": "M04-F07", "module": "M04", "title": "adapter fixture", "status": "passed_local", "evidence": ["test_codex_event_mapper.py"]},
    {"id": "M05-F01", "module": "M05", "title": "OAEP public DTO 校验", "status": "passed_local", "evidence": ["smoke_runtime_relay_public_v4.py"]},
    {"id": "M05-F02", "module": "M05", "title": "subject 授权", "status": "needs_physical_e2e", "evidence": ["physical Android association"]},
    {"id": "M05-F03", "module": "M05", "title": "cursor expired", "status": "passed_local", "evidence": ["test_relay_oaep_replay.py"]},
    {"id": "M05-F04", "module": "M05", "title": "stream timeout", "status": "passed_local", "evidence": ["test_relay_api.py"]},
    {"id": "M05-F05", "module": "M05", "title": "敏感字段扫描", "status": "passed_local", "evidence": ["smoke_runtime_relay_public_v4.py", "verify:oaep-stage3-readiness"]},
    {"id": "M06-F01", "module": "M06", "title": "Desktop 发起，Android 观察", "status": "needs_physical_e2e", "evidence": ["RealRemoteWorkspaceE2ETest"]},
    {"id": "M06-F02", "module": "M06", "title": "Android 发起，Desktop 观察", "status": "needs_physical_e2e", "evidence": ["RealRemoteWorkspaceE2ETest"]},
    {"id": "M06-F03", "module": "M06", "title": "工具调用一致", "status": "needs_physical_e2e", "evidence": ["RealRemoteWorkspaceE2ETest"]},
    {"id": "M06-F04", "module": "M06", "title": "审批一致", "status": "needs_physical_e2e", "evidence": ["RealRemoteWorkspaceE2ETest"]},
    {"id": "M06-F05", "module": "M06", "title": "文件变更一致", "status": "needs_physical_e2e", "evidence": ["RealRemoteWorkspaceE2ETest"]},
    {"id": "M06-F06", "module": "M06", "title": "TUI 预留", "status": "documented", "evidence": ["Stage 3 plan"]},
    {"id": "M07-F01", "module": "M07", "title": "Runtime scoped tests", "status": "passed_local", "evidence": ["pytest runtime OAEP groups"]},
    {"id": "M07-F02", "module": "M07", "title": "Desktop verifier", "status": "passed_local", "evidence": ["verify:oaep-release", "verify:oaep-stage3-readiness"]},
    {"id": "M07-F03", "module": "M07", "title": "Android unit tests", "status": "passed_local", "evidence": ["Gradle unit tests", "emulator instrumentation"]},
    {"id": "M07-F04", "module": "M07", "title": "E2E smoke script", "status": "needs_physical_e2e", "evidence": ["accept_mobile_remote_workspace_real_device_v4.py"]},
    {"id": "M07-F05", "module": "M07", "title": "dev owner guard", "status": "passed_local", "evidence": ["verify:gateway-smoke", "verify:oaep-stage3-readiness"]},
    {"id": "M08-F01", "module": "M08", "title": "协议覆盖矩阵", "status": "passed_local", "evidence": ["Stage 3 plan"]},
    {"id": "M08-F02", "module": "M08", "title": "chat_completion 边界文档", "status": "passed_local", "evidence": ["Stage 3 plan"]},
    {"id": "M08-F03", "module": "M08", "title": "Desktop/Android smoke 手册", "status": "passed_local", "evidence": ["Stage 3 plan"]},
    {"id": "M08-F04", "module": "M08", "title": "已知缺口清单", "status": "passed_local", "evidence": ["Stage 3 plan", "readiness report"]},
    {"id": "M08-F05", "module": "M08", "title": "TUI 接入建议", "status": "passed_local", "evidence": ["Stage 3 plan"]},
]


def _plan_ids(root: Path) -> set[str]:
    plan = root / PLAN.relative_to(ROOT)
    if not plan.is_file():
        raise RuntimeError("stage3_plan_missing")
    text = plan.read_text(encoding="utf-8")
    return {feature["id"] for feature in FEATURES if feature["id"] in text}


def _module_summaries(features: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for feature in features:
        grouped[feature["module"]].append(feature)
    summaries = []
    for module in sorted(grouped):
        rows = grouped[module]
        counts = Counter(row["status"] for row in rows)
        if counts.get("needs_physical_e2e"):
            status = "needs_physical_e2e"
        elif counts.get("passed_real"):
            status = "passed_real"
        else:
            status = "passed_local"
        summaries.append({
            "module": module,
            "total": len(rows),
            "status": status,
            "counts": dict(sorted(counts.items())),
        })
    return summaries


def read_json_report(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise RuntimeError(f"stage3_real_evidence_unreadable:{path}") from exc
    if not isinstance(value, dict):
        raise RuntimeError("stage3_real_evidence_invalid")
    return value


def validate_stage3_real_evidence(report: dict[str, Any]) -> dict[str, Any]:
    if report.get("passed") is not True or report.get("protocol") != "oaep/1":
        raise RuntimeError("stage3_real_evidence_failed")
    devices = report.get("devices")
    if not isinstance(devices, list) or len(devices) < 2:
        raise RuntimeError("stage3_real_evidence_two_devices_missing")
    proofs = {
        row.get("device_proof_sha256")
        for row in devices
        if (
            isinstance(row, dict)
            and isinstance(row.get("device_proof_sha256"), str)
            and DIGEST.fullmatch(row["device_proof_sha256"])
        )
    }
    if len(proofs) < 2:
        raise RuntimeError("stage3_real_evidence_device_proofs_invalid")
    checks = report.get("checks")
    if not isinstance(checks, list):
        raise RuntimeError("stage3_real_evidence_checks_missing")
    passed_checks = {
        str(row.get("name")): row
        for row in checks
        if isinstance(row, dict) and row.get("status") == "passed"
    }
    missing = REQUIRED_STAGE3_REAL_CHECKS - passed_checks.keys()
    if missing:
        raise RuntimeError("stage3_real_evidence_checks_missing:" + ",".join(sorted(missing)))
    for name in ("windows_to_android_two_runs", "android_to_windows_two_runs"):
        row = passed_checks[name]
        if not (
            int(row.get("run_count", 0)) >= 2
            and int(row.get("duplicate_sequence_count", row.get("duplicate_run_count", -1))) == 0
            and int(row.get("missing_sequence_count", -1)) == 0
        ):
            raise RuntimeError(f"stage3_real_evidence_{name}_invalid")
    convergence = passed_checks["oaep_hash_convergence"]
    hashes = {
        convergence.get("runtime_sha256"),
        convergence.get("windows_sha256"),
        convergence.get("android_sha256"),
    }
    if len(hashes) != 1 or not all(isinstance(value, str) and DIGEST.fullmatch(value) for value in hashes):
        raise RuntimeError("stage3_real_evidence_oaep_hash_invalid")
    approval = passed_checks["approval_single_decision"]
    if approval.get("successful_decisions") != 1 or approval.get("tool_execution_count") != 1:
        raise RuntimeError("stage3_real_evidence_approval_invalid")
    files = passed_checks["file_change_safe_paths"]
    if not (
        int(files.get("file_change_count", 0)) > 0
        and files.get("safe_relative_paths") is True
        and int(files.get("absolute_path_count", -1)) == 0
        and int(files.get("sensitive_field_count", -1)) == 0
    ):
        raise RuntimeError("stage3_real_evidence_file_paths_invalid")
    revocation = passed_checks["revocation_stream_closed"]
    if revocation.get("subsequent_status") != 403:
        raise RuntimeError("stage3_real_evidence_revocation_invalid")
    return {
        "status": "passed",
        "check_names": sorted(passed_checks),
        "device_count": len(devices),
        "oaep_sha256": next(iter(hashes)),
    }


def _feature_rows(real_evidence: dict[str, Any] | None) -> list[dict[str, Any]]:
    rows = [dict(feature) for feature in FEATURES]
    if real_evidence is None:
        return rows
    for row in rows:
        if row["id"] in PHYSICAL_FEATURE_IDS:
            row["status"] = "passed_real"
            row["evidence"] = [*row.get("evidence", []), "real-device-oaep-e2e.json"]
    return rows


def build_report(
    *,
    root: Path = ROOT,
    readiness: dict[str, Any] | None = None,
    require_complete: bool = False,
    adb: str = "adb",
    real_report: Path | None = DEFAULT_REAL_REPORT,
) -> dict[str, Any]:
    real_evidence: dict[str, Any] | None = None
    real_evidence_error: str | None = None
    real_report_missing = real_report is not None and not real_report.is_file()
    if real_report is not None:
        if real_report.is_file():
            try:
                real_evidence = validate_stage3_real_evidence(read_json_report(real_report))
            except RuntimeError as exc:
                real_evidence_error = str(exc)
    feature_rows = _feature_rows(real_evidence)
    ids_in_plan = _plan_ids(root)
    expected_ids = {feature["id"] for feature in feature_rows}
    missing_from_plan = sorted(expected_ids - ids_in_plan)
    duplicate_ids = [
        item_id for item_id, count in Counter(feature["id"] for feature in feature_rows).items()
        if count > 1
    ]
    if readiness is None:
        readiness_module = _load_readiness_module()
        readiness = readiness_module.build_report(root=root, adb=adb, require_device=False)

    counts = Counter(feature["status"] for feature in feature_rows)
    blockers = []
    if missing_from_plan:
        blockers.append({"code": "stage3_plan_feature_missing", "message": ",".join(missing_from_plan)})
    if duplicate_ids:
        blockers.append({"code": "stage3_audit_duplicate_feature", "message": ",".join(sorted(duplicate_ids))})
    if real_evidence_error is not None:
        blockers.append({"code": "stage3_real_evidence_invalid", "message": real_evidence_error})
    if real_report_missing and readiness.get("ready_for_real_device_e2e") is True:
        blockers.append({
            "code": "stage3_real_evidence_missing",
            "message": str(real_report),
        })
    if real_evidence is None:
        blockers.extend(readiness.get("blockers", []))

    needs_physical = [
        {"id": row["id"], "module": row["module"], "title": row["title"]}
        for row in feature_rows
        if row["status"] == "needs_physical_e2e"
    ]
    audit_valid = not missing_from_plan and not duplicate_ids and len(feature_rows) == 46
    complete = audit_valid and counts.get("needs_physical_e2e", 0) == 0 and real_evidence is not None
    passed = audit_valid and (complete or not require_complete)
    return {
        "schema_version": 1,
        "protocol": "oaep/1",
        "stage": 3,
        "feature_total": len(feature_rows),
        "expected_feature_total": 46,
        "audit_valid": audit_valid,
        "complete": complete,
        "passed": passed,
        "counts": dict(sorted(counts.items())),
        "completion_percent_local": round((counts.get("passed_local", 0) + counts.get("documented", 0)) / 46 * 100, 2),
        "completion_percent_with_real_evidence": round((counts.get("passed_local", 0) + counts.get("documented", 0) + counts.get("passed_real", 0)) / 46 * 100, 2),
        "module_summaries": _module_summaries(feature_rows),
        "features": feature_rows,
        "needs_physical_e2e": needs_physical,
        "real_evidence": real_evidence,
        "real_report": str(real_report) if real_report is not None else None,
        "readiness": {
            "ready_for_real_device_e2e": readiness.get("ready_for_real_device_e2e"),
            "adb": readiness.get("adb"),
            "blockers": readiness.get("blockers", []),
            "real_device_command": readiness.get("real_device_command"),
        },
        "blockers": blockers,
        "evidence_commands": [
            "npm --prefix apps\\desktop\\windows run typecheck",
            "npm --prefix apps\\desktop\\windows run verify:oaep-release",
            "npm --prefix apps\\desktop\\windows run verify:chat-output",
            "npm --prefix apps\\desktop\\windows run verify:remote-agent-contract",
            "npm --prefix apps\\desktop\\windows run verify:gateway-smoke",
            "npm --prefix apps\\desktop\\windows run verify:oaep-stage3-readiness",
            "npm --prefix apps\\desktop\\windows run verify:oaep-android-instrumentation",
            ".\\.venv\\Scripts\\python.exe -m pytest cores\\python\\packages\\drsai\\tests\\test_mobile_remote_workspace_real_device_v4.py -q",
            ".\\.venv\\Scripts\\python.exe -m pytest cores\\python\\packages\\drsai\\tests\\test_oaep_stage3_e2e_readiness.py cores\\python\\packages\\drsai\\tests\\test_oaep_stage3_android_instrumentation.py cores\\python\\packages\\drsai\\tests\\test_oaep_stage3_completion_audit.py -q",
            "python scripts\\accept_mobile_remote_workspace_real_device_v4.py --runtime-id <runtime_id> --workspace-id <workspace_id> --session-id <session_id> --expected-source-message-id <id>",
        ],
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--adb", default="adb")
    parser.add_argument("--require-complete", action="store_true")
    parser.add_argument("--real-report", type=Path, default=DEFAULT_REAL_REPORT)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = build_report(adb=args.adb, require_complete=args.require_complete, real_report=args.real_report)
    encoded = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + "\n", encoding="utf-8")
    print(encoded)
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
