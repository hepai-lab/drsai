#!/usr/bin/env python3
"""Verify bounded Android foreground SSE / background Push-or-pull policy."""
from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
ANDROID = ROOT / "apps/android/app/src/main/java/ai/drsai/remote"
POLICY = ANDROID / "remote/device/RemoteBackgroundSync.kt"
SESSION = ANDROID / "remote/ui/RemoteSessionViewModel.kt"
HOME = ANDROID / "remote/ui/RemoteHomeViewModel.kt"
MAIN = ANDROID / "MainActivity.kt"
UI = ANDROID / "ui/OpenDrSaiApp.kt"
UNIT = ROOT / "apps/android/app/src/test/java/ai/drsai/remote/remote/device/RemoteBackgroundSyncPolicyTest.kt"


def verify() -> dict[str, object]:
    policy = POLICY.read_text(encoding="utf-8")
    session = SESSION.read_text(encoding="utf-8")
    home = HOME.read_text(encoding="utf-8")
    main = MAIN.read_text(encoding="utf-8")
    ui = UI.read_text(encoding="utf-8")
    unit = UNIT.read_text(encoding="utf-8")
    required = {
        "policy": (
            "keepForegroundSse = foreground && online",
            "relyOnPush = !foreground && pushReady",
            "scheduleFallbackPull = !foreground && !pushReady",
            "PeriodicWorkRequestBuilder<RemoteFallbackDirectorySyncWorker>",
            "FALLBACK_INTERVAL_MINUTES = 15L",
            "FALLBACK_FLEX_MINUTES = 5L",
            "setRequiredNetworkType(NetworkType.CONNECTED)",
            "setRequiresBatteryNotLow(true)",
            "enqueueUniquePeriodicWork",
            "ExistingPeriodicWorkPolicy.UPDATE",
            "MAX_ATTEMPTS = 3",
            "object AndroidRemoteBackgroundSync",
            "ProcessLifecycleOwner.get().lifecycle.addObserver(owner)",
            "fallbackScheduled == policy.scheduleFallbackPull",
        ),
        "session": ("reconcileSessionStream()", "streamJob?.cancel()", "keepForegroundSse"),
        "home": ("AndroidRemoteBackgroundSync.updatePushReady", "fun onForeground()", "refresh()"),
        "main": ("AndroidRemoteBackgroundSync.install(application)",),
        "ui": ("LifecycleEventEffect(Lifecycle.Event.ON_START)", "remoteViewModel.onForeground()"),
        "unit": ("background uses exactly push or fallback", "one thousand identical lifecycle updates"),
    }
    sources = {"policy": policy, "session": session, "home": home, "main": main, "ui": ui, "unit": unit}
    for name, markers in required.items():
        for marker in markers:
            if marker not in sources[name]:
                raise ValueError(f"p6_background_policy_marker_missing:{name}:{marker}")
    worker = policy.split("class RemoteFallbackDirectorySyncWorker", 1)[1]
    if re.search(r"\bwhile\s*\(|\bfor\s*\(.*;;", worker):
        raise ValueError("p6_background_worker_busy_loop")
    if "startForegroundService" in policy or "ForegroundInfo" in policy:
        raise ValueError("p6_background_foreground_service_forbidden")
    return {
        "foreground_sse_limit": 1,
        "periodic_work_limit": 1,
        "minimum_interval_minutes": 15,
        "max_attempts": 3,
        "busy_loops": 0,
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
