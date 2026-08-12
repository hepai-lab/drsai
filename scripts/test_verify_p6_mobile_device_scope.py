from __future__ import annotations

import json
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def test_mobile_device_scope_verifier() -> None:
    result = subprocess.run(
        ["node", "--experimental-strip-types", str(ROOT / "scripts/verify_p6_mobile_device_scope.mjs")],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report == {
        "passed": True,
        "device_idor_cases": 4,
        "workspace_scopes": 2,
        "editor_state_cases": 3,
        "immediate_stream_invalidation": True,
        "authorization_expansion": "re-pair-required",
    }
