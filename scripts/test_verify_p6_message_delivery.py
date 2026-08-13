from __future__ import annotations

from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def test_p6_message_delivery_gate() -> None:
    result = subprocess.run(
        [
            "node",
            str(ROOT / "apps/desktop/shared/test-kit/run-bundled-test.mjs"),
            str(ROOT / "apps/desktop/windows/scripts/verify-p6-message-delivery.mts"),
        ],
        cwd=ROOT / "apps/desktop/windows",
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert '"passed":true' in result.stdout
