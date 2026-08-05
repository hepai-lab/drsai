import json
import subprocess
import sys
from pathlib import Path


def test_acceptance_verifier_requires_every_hard_gate(tmp_path: Path) -> None:
    repo = Path(__file__).parents[5]
    evidence = tmp_path / "evidence"
    evidence.mkdir()
    values = {
        "feature-evidence.json": {"summary": {"passed": 40}},
        "dependency-compatibility.json": {"result": "passed"},
        "cross-runtime-parity.json": {"result": "passed", "match_percent": 100},
        "security-scan.json": {"result": "passed"},
        "host-stress.json": {"result": "passed", "duplicate_side_effects": 0},
        "build-variants.json": {"result": "passed"},
        "device-performance.json": {
            "environment": {"physical_samsung_arm64_verified": True},
            "metrics": {
                "cold_start_p95_ms": 2999, "foreground_pss_p95_mb": 219, "peak_pss_mb": 319,
                "storage_mb": 219, "anr": 0, "runtime_release_verified": True,
            },
        },
    }
    for name, value in values.items():
        (evidence / name).write_text(json.dumps(value), encoding="utf-8")
    apk = tmp_path / "app.apk"
    apk.write_bytes(b"small")
    output = evidence / "acceptance-verification.json"
    command = [
        sys.executable, str(repo / "apps/android/scripts/verify-python-runtime-acceptance.py"),
        "--evidence", str(evidence), "--apk", str(apk), "--output", str(output),
    ]

    passed = subprocess.run(command, check=False)
    assert passed.returncode == 0
    assert json.loads(output.read_text())["decision"] == "GO"

    (evidence / "feature-evidence.json").write_text(json.dumps({"summary": {"passed": 39}}), encoding="utf-8")
    failed = subprocess.run(command, check=False)
    report = json.loads(output.read_text())
    assert failed.returncode == 2
    assert report["decision"] == "NO_GO"
    assert "function_40_of_40" in report["blockers"]
