from __future__ import annotations

from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def test_p6_long_session_navigation_gate() -> None:
    result = subprocess.run(
        [
            "node",
            str(ROOT / "apps/desktop/shared/test-kit/run-bundled-test.mjs"),
            str(ROOT / "scripts/verify_p6_long_session_navigation.mjs"),
        ],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
        timeout=30,
    )
    assert result.returncode == 0, result.stderr
    assert '"passed":true' in result.stdout
    assert '"items":100000' in result.stdout
    assert '"deltas":10000' in result.stdout
