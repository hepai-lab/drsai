#!/usr/bin/env python3
"""Verify P6 Android transport-generation and bounded SSE recovery invariants."""
from __future__ import annotations

import json
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/remote"
CONNECTIVITY = ANDROID / "data/AndroidRemoteConnectivity.kt"
RELIABILITY = ANDROID / "data/RemoteReliability.kt"
SESSION_STATE = ANDROID / "data/RemoteSessionStateMachines.kt"
SESSION = ANDROID / "ui/RemoteSessionViewModel.kt"
CATALOG = ANDROID / "ui/WorkspaceSessionsViewModel.kt"
UNIT = ROOT / "apps/android/app/src/test/java/ai/drsai/remote/RemoteReliabilityTest.kt"
STATE_UNIT = ROOT / "apps/android/app/src/test/java/ai/drsai/remote/remote/data/RemoteSessionStateMachinesTest.kt"


def verify() -> dict[str, object]:
    sources = {
        "connectivity": CONNECTIVITY.read_text(encoding="utf-8"),
        "reliability": RELIABILITY.read_text(encoding="utf-8"),
        "session_state": SESSION_STATE.read_text(encoding="utf-8"),
        "session": SESSION.read_text(encoding="utf-8"),
        "catalog": CATALOG.read_text(encoding="utf-8"),
        "unit": UNIT.read_text(encoding="utf-8"),
        "state_unit": STATE_UNIT.read_text(encoding="utf-8"),
    }
    required = {
        "connectivity": (
            "val state: StateFlow<RemoteNetworkState>",
            "generation.observe(network?.toString(), online, metered)",
        ),
        "reliability": (
            "class RemoteNetworkGenerationTracker",
            "class RemoteStreamRetryState",
            "maxWindowMs: Long = 120_000",
            "failure.status == 408 || failure.status == 429 || failure.status >= 500",
            "is java.io.IOException",
        ),
        "session_state": (
            "SessionSyncPhase.AUTH_REQUIRED, SessionSyncPhase.REVOKED -> current.phase",
        ),
        "session": (
            "connectivity.state.collect",
            "RemoteStreamRetryState(retryPolicy)",
            "requiresSnapshotRecovery()",
            "retry.nextDelay(failure, time.monotonicNanos()) ?: break",
        ),
        "catalog": (
            "ProcessLifecycleOwner.get().lifecycle.addObserver(lifecycleObserver)",
            "connectivity.state.collect",
            "RemoteStreamRetryState(RemoteRetryPolicy())",
            "relay_workspace_catalog_sse_eof",
            "retry.nextDelay(failure, time.monotonicNanos()) ?: break",
            "container.singleFlight.run(\"workspace:",
        ),
        "unit": (
            "wifi to cellular rebuilds transport even while still online",
            "stream retry covers eof 429 and 5xx but remains bounded",
        ),
        "state_unit": (
            "network_and_lifecycle_changes_never_clear_auth_or_revocation",
        ),
    }
    for name, markers in required.items():
        for marker in markers:
            if marker not in sources[name]:
                raise ValueError(f"p6_network_recovery_marker_missing:{name}:{marker}")
    if "while (true)" in sources["catalog"]:
        raise ValueError("p6_catalog_unbounded_retry_loop")
    return {
        "network_generation": True,
        "retry_window_ms": 120_000,
        "cursor_snapshot_recovery": True,
        "catalog_single_flight": True,
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
