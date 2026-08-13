#!/usr/bin/env python3
"""Verify one authoritative Android Session UI reducer and generation fencing."""
from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
AUTHORITY = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/remote/data/RemoteSessionUiAuthority.kt"
SCREEN = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteSessionScreens.kt"
VIEW_MODEL = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/remote/ui/RemoteSessionViewModel.kt"
TEST = ROOT / "apps/android/app/src/test/java/ai/drsai/remote/remote/data/RemoteSessionUiAuthorityTest.kt"


def verify() -> dict[str, object]:
    authority = AUTHORITY.read_text(encoding="utf-8")
    screen = SCREEN.read_text(encoding="utf-8")
    view_model = VIEW_MODEL.read_text(encoding="utf-8")
    tests = TEST.read_text(encoding="utf-8")
    for marker in (
        "class RemoteSessionUiAuthorityReducer", "if (event.generation < state.generation) return state",
        "remote_session_ui_run_state_conflict", "remote_session_ui_lifecycle_conflict",
        "RemoteSessionUiAuthorityEvent.Snapshot", "repeat(10_000)",
        "stale_generation_cannot_overwrite_new_state",
    ):
        if marker not in f"{authority}\n{tests}":
            raise ValueError(f"p6_session_ui_authority_gate_missing:{marker}")
    state_signature = screen.split("data class RemoteChatUiState(", 1)[1].split(") {", 1)[0]
    for obsolete in ("val online:", "val running:", "val connectionState:", "val canRetry:"):
        if obsolete in state_signature:
            raise ValueError(f"p6_session_ui_duplicate_authority:{obsolete}")
    for field in ("online", "running", "connectionState", "canRetry"):
        if not re.search(rf"val\s+{field}:[^\n]+get\(\)\s*=\s*authority\.", screen):
            raise ValueError(f"p6_session_ui_not_derived:{field}")
        if re.search(rf"\b{field}\s*=(?!=)", view_model):
            raise ValueError(f"p6_session_ui_direct_write:{field}")
    for marker in (
        "RemoteSessionUiAuthorityReducer()", "authoritativeConnection(",
        "authoritativeRun(", "authoritativeSnapshot(",
    ):
        if marker not in view_model:
            raise ValueError(f"p6_session_ui_authority_not_integrated:{marker}")
    return {"derived_fields": 4, "generation_fenced": True, "passed": True}


def main() -> int:
    try:
        value = verify()
    except (OSError, ValueError) as exc:
        raise SystemExit(str(exc)) from exc
    print(json.dumps(value, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
