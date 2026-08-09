from __future__ import annotations

import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PLAN = ROOT / "docs/android/plans/runtime/ANDROID_P9_DESKTOP_FULL_AGENT_RUNTIME_PARITY_DEVELOPMENT_PLAN.md"
LEDGER = ROOT / "docs/android/reports/progress/ANDROID_P9_ACCEPTANCE_LEDGER.json"
EVIDENCE = ROOT / "docs/android/reports/evidence/p9"
OUTPUT = EVIDENCE / "m12-f06-final-go-no-go.json"
EXPECTED_IDS = [f"M{module:02d}-F{feature:02d}" for module in range(1, 13) for feature in range(1, 7)]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load(path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, dict):
        raise RuntimeError(f"evidence_not_object:{path}")
    return value


def apk_hash(report: dict[str, Any]) -> str | None:
    for key in ("candidate_apk_sha256", "apk_sha256"):
        if isinstance(report.get(key), str):
            return str(report[key]).lower()
    provenance = report.get("provenance")
    if isinstance(provenance, dict) and isinstance(provenance.get("app_apk_sha256"), str):
        return str(provenance["app_apk_sha256"]).lower()
    apk = report.get("apk")
    if isinstance(apk, dict) and isinstance(apk.get("sha256"), str):
        return str(apk["sha256"]).lower()
    return None


def main() -> int:
    parser = argparse.ArgumentParser(description="P9 final fail-closed Go/No-Go aggregator")
    parser.add_argument("--output", type=Path, default=OUTPUT)
    args = parser.parse_args()
    reports = {
        "m04_real_tool_selection": EVIDENCE / "m04-f06-natural-tool-selection.json",
        "m09_real_model_statistics": EVIDENCE / "m09-f06-real-model-statistics.json",
        "m11_security": EVIDENCE / "m11-f01-unified-tool-security.json",
        "m11_recovery": EVIDENCE / "m11-f02-exactly-once-recovery.json",
        "m11_supply_chain": EVIDENCE / "m11-f03-supply-chain.json",
        "m11_performance": EVIDENCE / "m11-f04-runtime-performance.json",
        "m11_migration": EVIDENCE / "m11-f05-runtime-migration.json",
        "m12_machine_ledger": EVIDENCE / "m12-f01-machine-ledger.json",
        "m12_production_parity": EVIDENCE / "m12-f02-production-behavior-parity.json",
        "m12_natural_tasks": EVIDENCE / "m12-f03-natural-task-golden.json",
        "m12_device_matrix": EVIDENCE / "m12-f04-device-matrix.json",
        "m12_legacy_retirement": EVIDENCE / "m12-f05-legacy-path-retirement.json",
        "clean_build": EVIDENCE / "m12-f06-clean-build.json",
    }
    available = {name: load(path) for name, path in reports.items() if path.is_file()}
    ledger = load(LEDGER)
    items = ledger.get("items", [])
    statuses = {str(item.get("id")): item.get("status") for item in items if isinstance(item, dict)}
    accepted = {feature_id for feature_id, status in statuses.items() if status == "accepted"}
    plan_ids = sorted(set(re.findall(r"\bM(?:0[1-9]|1[0-2])-F0[1-6]\b", PLAN.read_text(encoding="utf-8"))))
    clean = available.get("clean_build", {})
    real = available.get("m09_real_model_statistics", {})
    m04 = available.get("m04_real_tool_selection", {})
    device = available.get("m12_device_matrix", {})
    candidate_hash = str(clean.get("apk_sha256") or "").lower()
    bound_reports = [
        available.get(name, {}) for name in (
            "m04_real_tool_selection", "m09_real_model_statistics", "m11_supply_chain",
            "m11_performance", "m12_device_matrix",
        )
    ]
    required_nonfinal = set(EXPECTED_IDS) - {"M12-F06"}

    gates = {
        "plan_and_ledger_have_exactly_72_unique_features": (
            plan_ids == EXPECTED_IDS and list(statuses) == EXPECTED_IDS and len(statuses) == 72
        ),
        "all_71_nonfinal_features_are_accepted": required_nonfinal <= accepted,
        "final_feature_is_pending_or_accepted_only": statuses.get("M12-F06") in {"pending", "accepted"},
        "all_required_reports_exist_and_are_green": (
            set(available) == set(reports) and all(report.get("passed") is True for report in available.values())
        ),
        "clean_checkout_candidate_build_is_reproducible": (
            clean.get("clean_checkout") is True
            and clean.get("git_status_porcelain") == ""
            and bool(re.fullmatch(r"[0-9a-f]{40}", str(clean.get("git_commit", ""))))
            and clean.get("assemble_debug") is True
            and clean.get("assemble_android_test") is True
            and clean.get("android_jvm_failures") == 0
            and clean.get("python_failures") == 0
        ),
        "real_model_gate_has_exactly_180_physical_attempts": (
            real.get("passed") is True
            and real.get("raw_counts", {}).get("attempts") == 180
            and [row.get("model") for row in real.get("models", [])] == ["deepseek-v4-flash", "deepseek-v4-pro"]
            and real.get("environment", {}).get("kind") == "physical_device"
            and str(real.get("environment", {}).get("abi", "")).startswith("arm64")
        ),
        "m04_reuses_exactly_the_90_flash_attempts": (
            m04.get("passed") is True
            and m04.get("behavior_attempts") == 90
            and m04.get("provenance", {}).get("reused_from_feature") == "M09-F06"
            and len(m04.get("raw_observations", [])) == 90
        ),
        "device_matrix_covers_api_26_30_35_36_and_arm64": (
            device.get("passed") is True
            and {row.get("api") for row in device.get("devices", [])} == {26, 30, 35, 36}
            and any(row.get("abi") == "arm64-v8a" for row in device.get("devices", []))
        ),
        "security_recovery_performance_migration_and_legacy_retirement_are_green": all(
            available.get(name, {}).get("passed") is True for name in (
                "m11_security", "m11_recovery", "m11_performance", "m11_migration", "m12_legacy_retirement",
            )
        ),
        "production_parity_and_natural_tasks_are_green": (
            available.get("m12_production_parity", {}).get("passed") is True
            and available.get("m12_natural_tasks", {}).get("passed") is True
        ),
        "all_candidate_bound_reports_use_the_clean_build_apk": (
            len(candidate_hash) == 64 and all(apk_hash(report) == candidate_hash for report in bound_reports)
        ),
    }
    report = {
        "schema_version": 1,
        "feature_id": "M12-F06",
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "decision": "GO" if all(gates.values()) else "NO-GO",
        "passed": all(gates.values()),
        "accepted_before_final": len(accepted - {"M12-F06"}),
        "candidate_apk_sha256": candidate_hash or None,
        "gates": gates,
        "evidence_sha256": {
            str(path.relative_to(ROOT)).replace("\\", "/"): digest(path)
            for path in reports.values() if path.is_file()
        },
        "source_sha256": {
            str(PLAN.relative_to(ROOT)).replace("\\", "/"): digest(PLAN),
            "scripts/accept_android_p9_final_go_no_go.py": digest(Path(__file__)),
        },
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({
        "passed": report["passed"], "decision": report["decision"],
        "gates": sum(gates.values()), "total": len(gates),
        "accepted_before_final": report["accepted_before_final"],
    }))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
