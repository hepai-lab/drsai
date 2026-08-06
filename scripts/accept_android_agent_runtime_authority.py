from __future__ import annotations

import json
import re
from datetime import UTC, datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / "apps/android/app/src/main/java"


def main() -> int:
    files = list(MAIN.rglob("*.kt"))
    forbidden_patterns = {
        "legacy_fact_source_switch": re.compile(r"(?i)(enable|use|allow)[A-Za-z_]*(legacy|private)[A-Za-z_]*(fact|authority|projection)"),
        "mutable_fact_authority": re.compile(r"(?i)(var|MutableStateFlow<)[^\n]*(FactAuthority|factAuthority)"),
    }
    findings = []
    for path in files:
        text = path.read_text(encoding="utf-8")
        for rule, pattern in forbidden_patterns.items():
            for match in pattern.finditer(text):
                findings.append({"rule": rule, "file": str(path.relative_to(ROOT)).replace("\\", "/"), "line": text.count("\n", 0, match.start()) + 1})
    gate = (MAIN / "ai/drsai/remote/runtime/oaep/AndroidOaepReleaseGate.kt").read_text(encoding="utf-8")
    app = (MAIN / "ai/drsai/remote/AppViewModel.kt").read_text(encoding="utf-8")
    checks = {
        "no_enableable_legacy_fact_switch": not findings,
        "oaep_authority_immutable": "val factAuthority: AndroidFactAuthority = AndroidFactAuthority.OAEP_SNAPSHOT" in gate and "enum class AndroidFactAuthority { OAEP_SNAPSHOT }" in gate,
        "ui_reads_oaep_projection": "LocalOaepLegacyProjection" in app,
        "legacy_bridge_is_projection_only": "class LocalOaepLegacyProjection" in (MAIN / "ai/drsai/remote/runtime/oaep/LocalOaepLegacyProjection.kt").read_text(encoding="utf-8"),
    }
    report = {"schema_version": 1, "generated_at": datetime.now(UTC).isoformat(), "findings": findings, "checks": checks, "passed": all(checks.values())}
    output = ROOT / "docs/android/reports/evidence/android-agent-runtime-authority-retirement.json"
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
