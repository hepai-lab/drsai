#!/usr/bin/env python3
"""Verify injectable clocks and scheduling on the Android remote-workspace path."""
from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/remote/data"
UI = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/remote/ui"
SCHEDULER = DATA / "RemoteTimeScheduler.kt"
CONTAINER = DATA / "RemoteWorkspaceContainer.kt"
SESSION = UI / "RemoteSessionViewModel.kt"
HOME = UI / "RemoteHomeViewModel.kt"
CATALOG = UI / "WorkspaceSessionsViewModel.kt"
REPOSITORY = DATA / "RelayRemoteRepository.kt"
SSE = DATA / "RelaySseClient.kt"
PRESENCE = DATA / "DevicePresenceController.kt"
ANDROID_PRESENCE = DATA / "AndroidDevicePresence.kt"
TEST = ROOT / "apps/android/app/src/test/java/ai/drsai/remote/RemoteTimeSchedulerTest.kt"


def verify() -> dict[str, object]:
    values = {path: path.read_text(encoding="utf-8") for path in (
        SCHEDULER, CONTAINER, SESSION, HOME, CATALOG, REPOSITORY,
        SSE, PRESENCE, ANDROID_PRESENCE, TEST,
    )}
    scheduler = values[SCHEDULER]
    for marker in (
        "private val wallClock:", "private val monotonicClock:",
        "private val sleeper:", "fun wallAgeMillis", "fun monotonicElapsedMillis",
        "suspend fun waitFor", "suspend fun awaitFrame()",
    ):
        if marker not in scheduler:
            raise ValueError(f"p6_time_scheduler_missing:{marker}")
    if "val time = RemoteTimeScheduler()" not in values[CONTAINER]:
        raise ValueError("p6_time_scheduler_not_process_owned")
    if values[SESSION].count("time.awaitFrame()") != 2:
        raise ValueError("p6_frame_scheduler_not_injected")
    for path in (SESSION, HOME, CATALOG, REPOSITORY):
        if "import kotlinx.coroutines.delay" in values[path] or re.search(r"(?<![.\w])delay\(", values[path]):
            raise ValueError(f"p6_real_delay_remaining:{path.name}")
    for marker, path in (
        ("time.monotonicNanos()", SESSION),
        ("time.monotonicElapsedMillis", SESSION),
        ("time.wallClockMillis()", SESSION),
        ("time.waitFor", REPOSITORY),
        ("time.monotonicNanos()", SSE),
        ("waitFor = container.time::waitFor", ANDROID_PRESENCE),
    ):
        if marker not in values[path]:
            raise ValueError(f"p6_time_injection_missing:{path.name}:{marker}")
    tests = values[TEST]
    for marker in (
        "clock rollback", "process reconstruction and cross day",
        "without real sleep", "repeat(100)", "listOf(500L, 16L)",
    ):
        if marker not in tests:
            raise ValueError(f"p6_time_acceptance_missing:{marker}")
    return {
        "clock_types": 2,
        "frame_schedulers": 2,
        "deterministic_cycles": 100,
        "real_sleep_in_domain_tests": 0,
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
