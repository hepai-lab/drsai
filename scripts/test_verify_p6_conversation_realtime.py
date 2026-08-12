from __future__ import annotations

import json
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]


def test_p6_conversation_realtime_gate() -> None:
    result = subprocess.run(
        ["node", str(ROOT / "apps/desktop/shared/test-kit/run-bundled-test.mjs"),
         str(ROOT / "scripts/verify_p6_conversation_realtime.mjs")],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    payload = json.loads(result.stdout)
    assert payload["passed"] is True
    assert payload["realtime_item_kinds"] == 5
    assert payload["checkpoint_clients"] == ["runtime", "desktop", "android"]
