#!/usr/bin/env python3
"""Verify P6 host status explanations stay product-facing and Compose-tested."""
from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
UI = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/remote/ui"
MODEL = UI / "RemoteHostStatusPresentation.kt"
SCREEN = UI / "RemoteWorkspaceScreens.kt"
UNIT = ROOT / "apps/android/app/src/test/java/ai/drsai/remote/remote/ui/RemoteHostStatusPresentationTest.kt"
COMPOSE = ROOT / "apps/android/app/src/androidTest/java/ai/drsai/remote/remote/ui/RemoteWorkspaceUiTest.kt"


def verify() -> dict[str, object]:
    model = MODEL.read_text(encoding="utf-8")
    screen = SCREEN.read_text(encoding="utf-8")
    unit = UNIT.read_text(encoding="utf-8")
    compose = COMPOSE.read_text(encoding="utf-8")
    for marker in (
        'title = "在线"', 'title = "离线"', 'title = "已暂停"',
        'title = "需要更新"', 'title = "通知未启用"',
        'RemoteLifecycleState.REVOKED',
    ):
        source = unit if marker == "RemoteLifecycleState.REVOKED" else model
        if marker not in source:
            raise ValueError(f"p6_host_status_missing:{marker}")
    for field in ("val instanceId:", "val connectionGeneration:"):
        if field in screen:
            raise ValueError(f"p6_host_ui_internal_field:{field}")
    if "OpenDrSai Runtime" in screen:
        raise ValueError("p6_host_ui_runtime_term_exposed")
    if re.search(r'"[^"\n]*(?:generation|wss|issuer)[^"\n]*"', model, re.IGNORECASE):
        raise ValueError("p6_host_ui_transport_term_exposed")
    for marker in (
        "hostStatusSemanticAndScreenshotMatrixCoversSixProductStates",
        "captureToImage()", "assertEquals(6, snapshots.size)",
        "useUnmergedTree = true",
    ):
        if marker not in compose:
            raise ValueError(f"p6_host_compose_matrix_missing:{marker}")
    return {
        "product_states": 6,
        "compose_snapshots": 6,
        "internal_ui_fields": 0,
        "passed": True,
    }


def main() -> int:
    try:
        result = verify()
    except (OSError, ValueError) as exc:
        raise SystemExit(str(exc)) from exc
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
