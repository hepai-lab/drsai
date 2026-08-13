from __future__ import annotations

import json
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def test_session_catalog_realtime_verifier() -> None:
    result = subprocess.run(
        ["node", "--experimental-strip-types", str(ROOT / "scripts/verify_p6_session_catalog_realtime.mjs")],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert json.loads(result.stdout) == {
        "passed": True,
        "transitions": 4,
        "manual_refreshes": 0,
        "typed_clients": ["android", "desktop"],
        "recovery": "connect-refresh-plus-durable-runtime-journal",
        "catalog_scale_fixture": 10_000,
    }
