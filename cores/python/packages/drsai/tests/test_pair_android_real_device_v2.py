from __future__ import annotations

import importlib.util
import json
import sys
from datetime import UTC, datetime
from pathlib import Path

from drsai.relay.mobile_pairing import MobilePairingGrant


ROOT = Path(__file__).resolve().parents[5]
SCRIPT = ROOT / "scripts/pair_android_real_device_v2.py"
SPEC = importlib.util.spec_from_file_location("pair_android_real_device", SCRIPT)
assert SPEC and SPEC.loader
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)


def test_pairing_report_never_contains_code_or_payload() -> None:
    grant = MobilePairingGrant(
        "ag_" + "1" * 32,
        "temporary-code-must-not-leak",
        datetime(2026, 7, 26, tzinfo=UTC),
        "consumed",
        "opendrsai://associate?code=temporary-code-must-not-leak",
    )
    report = MODULE.safe_report(
        {"runtime_id": "runtime-a", "environment": "development"},
        grant,
        device="device-a",
        dispatched=True,
    )
    encoded = json.dumps(report)
    assert "temporary-code-must-not-leak" not in encoded
    assert "payload" not in report and "code" not in report
    assert report["associated"] is True
