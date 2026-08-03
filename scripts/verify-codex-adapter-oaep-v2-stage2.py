from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PLAN = ROOT / "docs/remote_workespace/OpenDrSaiCodexAdapter_OAEP重构开发方案V2_第二阶段.md"
LIVE = ROOT / "docs/remote_workespace/evidence/codex-adapter-oaep-v2-stage2-live.json"
DEFAULT_OUTPUT = ROOT / "docs/remote_workespace/evidence/codex-adapter-oaep-v2-stage2-matrix.json"
MODULE_COUNTS = {"M01": 7, "M02": 7, "M03": 6, "M04": 6, "M05": 6, "M06": 5, "M07": 6, "M08": 5, "M09": 5, "M10": 5}


def run(name: str, command: list[str], cwd: Path, env: dict[str, str] | None = None) -> dict[str, object]:
    completed = subprocess.run(command, cwd=cwd, env=env, text=True, capture_output=True)
    tail = "\n".join((completed.stdout + "\n" + completed.stderr).splitlines()[-20:])
    return {"name": name, "passed": completed.returncode == 0, "command": command, "output_tail": tail}


def checks() -> list[dict[str, object]]:
    python = ROOT / ".venv/Scripts/python.exe"
    npm = "npm.cmd" if os.name == "nt" else "npm"
    results = [
        run("python-adapter-fake-security-recovery", [str(python), "-m", "pytest",
            "cores/python/packages/drsai/tests/test_codex_native_decoder.py",
            "cores/python/packages/drsai/tests/test_codex_event_mapper.py",
            "cores/python/packages/drsai/tests/test_codex_jsonrpc_client.py",
            "cores/python/packages/drsai/tests/test_codex_backend_client.py",
            "cores/python/packages/drsai/tests/test_codex_security.py",
            "cores/python/packages/drsai/tests/test_codex_app_server_process.py", "-q"], ROOT),
        run("python-oaep-schema-relay-stress", [str(python), "-m", "pytest",
            "cores/python/packages/drsai/tests/test_oaep_protocol.py",
            "cores/python/packages/drsai/tests/test_oaep_codegen.py",
            "cores/python/packages/drsai/tests/test_oaep_compatibility.py",
            "cores/python/packages/drsai/tests/test_relay_oaep_replay.py",
            "cores/python/packages/drsai/tests/test_relay_oaep_performance.py",
            "cores/python/packages/drsai/tests/test_codex_release_stress.py", "-q"], ROOT),
        run("desktop-types", [npm, "run", "typecheck:windows"], ROOT / "apps/desktop"),
        run("desktop-oaep-contract", [npm, "run", "verify:oaep-runtime-contract"], ROOT / "apps/desktop/windows"),
        run("desktop-session-reducer", [npm, "run", "verify:session-conversation-subscription"], ROOT / "apps/desktop/windows"),
        run("desktop-session-recovery", [npm, "run", "verify:session-sync-state"], ROOT / "apps/desktop/windows"),
    ]
    java_home = Path(r"C:\Program Files\Android\Android Studio\jbr")
    android_env = dict(os.environ)
    if java_home.is_dir():
        android_env["JAVA_HOME"] = str(java_home)
    gradle = ROOT / "apps/android" / ("gradlew.bat" if os.name == "nt" else "gradlew")
    results.append(run("android-oaep-relay", [str(gradle), ":app:testDebugUnitTest",
        "--tests", "ai.drsai.remote.OaepJsonCodecTest",
        "--tests", "ai.drsai.remote.OaepProjectionTest",
        "--tests", "ai.drsai.remote.RelayRemoteRepositoryTest",
        "--tests", "ai.drsai.remote.RemoteConversationTest"], ROOT / "apps/android", android_env))
    return results


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--skip-tests", action="store_true", help="Only validate previously generated evidence.")
    args = parser.parse_args()
    if not PLAN.is_file() or not LIVE.is_file():
        raise SystemExit("stage2_required_evidence_missing")
    live = json.loads(LIVE.read_text(encoding="utf-8"))
    test_results = [] if args.skip_tests else checks()
    tests_passed = bool(test_results) and all(bool(item["passed"]) for item in test_results)
    live_passed = (
        live.get("status") == "accepted"
        and len(live.get("turn_ids", [])) == 3
        and len(set(live.get("turn_ids", []))) == 3
        and live.get("context_retained_after_restart") is True
        and all(run.get("message_delta_count", 0) > 0 and run.get("converged") is True for run in live.get("oaep_runs", []))
    )
    accepted = tests_passed and live_passed
    features = []
    for module, count in MODULE_COUNTS.items():
        for index in range(1, count + 1):
            features.append({
                "id": f"S2-{module}-F{index:02d}",
                "status": "accepted" if accepted else "blocked",
                "implementation": str(PLAN.relative_to(ROOT)).replace("\\", "/"),
                "tests": [item["name"] for item in test_results],
                "evidence": str(LIVE.relative_to(ROOT)).replace("\\", "/") if module == "M09" else "generated:test-results",
            })
    if len(features) != 58 or len({item["id"] for item in features}) != 58:
        raise SystemExit("stage2_feature_matrix_invalid")
    report = {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "plan": str(PLAN.relative_to(ROOT)).replace("\\", "/"),
        "total": 58,
        "accepted": sum(item["status"] == "accepted" for item in features),
        "passed": accepted and all(item["status"] == "accepted" for item in features),
        "checks": test_results,
        "features": features,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"passed": report["passed"], "accepted": report["accepted"], "total": 58}))
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
