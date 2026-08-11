from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
MAIN = ROOT / "apps/android/app/src/main"
APK = ROOT / "apps/android/app/build/outputs/apk/debug/OpenDrSai-Android-v1.5.6.apk"
OUTPUT = ROOT / "docs/android/reports/evidence/v1.5.6/ui-diagnostics.json"


def contains_all(path: Path, values: tuple[str, ...]) -> bool:
    text = path.read_text(encoding="utf-8")
    return all(value in text for value in values)


def main() -> int:
    ui = MAIN / "java/ai/drsai/remote/ui/OpenDrSaiApp.kt"
    models = MAIN / "java/ai/drsai/remote/data/Models.kt"
    view_model = MAIN / "java/ai/drsai/remote/AppViewModel.kt"
    production_text = "\n".join(
        path.read_text(encoding="utf-8", errors="replace")
        for path in MAIN.rglob("*") if path.is_file() and path.suffix in {".kt", ".xml", ".py"}
    )
    banned = ("轻量智能 Agent", "Lite Runtime", "Kotlin Lite", "Lite Agent")
    findings = [value for value in banned if value.casefold() in production_text.casefold()]
    features = {
        "M06-F01": not findings and contains_all(ui, ("Android Full Agent Runtime", "Full Agent Runtime")),
        "M06-F02": contains_all(ui, ("Full Local", "Remote Platform", "执行路由")),
        "M06-F03": contains_all(
            models,
            ("buildEnabled", "bindingState", "health", "process", "starts", "bindAttempts", "bindSuccesses"),
        ) and contains_all(ui, ("full-runtime-diagnostic", "runtime-policy-diagnostic")),
        "M06-F04": contains_all(
            models,
            ("availableTools", "permissionRequiredTools", "modelUnsupportedTools", "availableSkills", "permissionRequiredSkills"),
        ) and contains_all(view_model, ("permissionRequiredTools =", "modelUnsupportedTools =", "availableSkills =")),
        "M06-F05": contains_all(ui, ("重试绑定", "导出诊断")) and "bindReason" in models.read_text(encoding="utf-8"),
        "M06-F06": contains_all(models, ("kotlinFallbackAvailable: Boolean = false", "kotlin_fallback_available="))
        and "kotlin-fallback-indicator" in ui.read_text(encoding="utf-8"),
    }
    report = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "apk": {"path": str(APK), "sha256": hashlib.sha256(APK.read_bytes()).hexdigest()},
        "banned_production_label_findings": findings,
        "features": features,
        "passed": all(features.values()),
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
