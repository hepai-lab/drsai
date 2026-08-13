#!/usr/bin/env python3
"""Verify honest Push readiness and foreground catch-up across Relay and Android."""
from __future__ import annotations

import json
import sys
from pathlib import Path

from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "cores/python/packages/drsai/src"
sys.path.insert(0, str(PACKAGE))

from drsai.relay.api import create_relay_app  # noqa: E402
from drsai.relay.registry import RelayRegistry  # noqa: E402


ANDROID = ROOT / "apps/android/app/src/main/java/ai/drsai/remote"
REPOSITORY = ANDROID / "remote/data/RelayRemoteRepository.kt"
POLICY = ANDROID / "remote/ui/RemotePushReadinessPolicy.kt"
HOME = ANDROID / "remote/ui/RemoteHomeViewModel.kt"
APP = ANDROID / "ui/OpenDrSaiApp.kt"
PRESENTATION = ANDROID / "remote/ui/RemoteHostStatusPresentation.kt"
OPENAPI = ROOT / "cores/protocol/relay/runtime-relay.openapi.json"


def verify() -> dict[str, object]:
    matrix: list[dict[str, object]] = []
    for providers, worker in (
        (frozenset(), False),
        (frozenset(), True),
        (frozenset({"fcm"}), False),
        (frozenset({"fcm"}), True),
    ):
        response = TestClient(create_relay_app(
            registry=RelayRegistry(supported_push_providers=providers),
            push_worker_running=worker,
        )).get("/v1/push/readiness")
        if response.status_code != 200:
            raise ValueError("p6_push_readiness_http_failed")
        payload = response.json()
        if set(payload) != {"ready", "providers", "worker_running"} or set(payload["providers"]) != {"fcm"}:
            raise ValueError("p6_push_readiness_contract_drift")
        expected_ready = "fcm" in providers and worker
        if payload["ready"] is not expected_ready:
            raise ValueError("p6_push_readiness_false_success")
        matrix.append(payload)

    sources = {
        "repository": REPOSITORY.read_text(encoding="utf-8"),
        "policy": POLICY.read_text(encoding="utf-8"),
        "home": HOME.read_text(encoding="utf-8"),
        "app": APP.read_text(encoding="utf-8"),
        "presentation": PRESENTATION.read_text(encoding="utf-8"),
    }
    required = {
        "repository": ('segments("v1", "push", "readiness")', "push_readiness_inconsistent"),
        "policy": ("platform?.ready == true", "PLATFORM_UNAVAILABLE"),
        "home": ("notificationReadinessGeneration", "fun onForeground()", "refresh()"),
        "app": ("LifecycleEventEffect(Lifecycle.Event.ON_START)", "remoteViewModel.onForeground()"),
        "presentation": ("打开 App 后会自动同步最新进度", "后台通知暂不可用"),
    }
    for name, markers in required.items():
        for marker in markers:
            if marker not in sources[name]:
                raise ValueError(f"p6_push_readiness_marker_missing:{name}:{marker}")

    schema = json.loads(OPENAPI.read_text(encoding="utf-8"))
    if "/v1/push/readiness" not in schema.get("paths", {}):
        raise ValueError("p6_push_readiness_openapi_missing")
    return {
        "matrix_cases": len(matrix),
        "ready_cases": sum(1 for item in matrix if item["ready"]),
        "foreground_catch_up": True,
        "honest_degradation": True,
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
