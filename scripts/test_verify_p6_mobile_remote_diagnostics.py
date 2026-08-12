from __future__ import annotations

import json
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def test_mobile_remote_diagnostics_verifier() -> None:
    result = subprocess.run(
        ["node", "--experimental-strip-types", str(ROOT / "scripts/verify_p6_mobile_remote_diagnostics.mjs")],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {
        "passed": True,
        "fixtures": 7,
        "unique_actions": 7,
        "diagnostic_packages_scanned": 7,
        "sensitive_matches": 0,
        "clients": ["desktop", "android"],
    }
