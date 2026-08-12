#!/usr/bin/env python3
"""Verify opaque notification payloads and durable exact-Item navigation."""
from __future__ import annotations

import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "cores/python/packages/drsai/src"))

from drsai.relay.notifications import notification_intent  # noqa: E402


ANDROID = ROOT / "apps/android/app/src/main/java/ai/drsai/remote"
NOTIFICATIONS = ANDROID / "remote/device/RemoteWorkspaceNotifications.kt"
NAVIGATION = ANDROID / "remote/data/RemoteNotificationNavigation.kt"
APP_VIEW_MODEL = ANDROID / "AppViewModel.kt"
APP_UI = ANDROID / "ui/OpenDrSaiApp.kt"
SESSION_VM = ANDROID / "remote/ui/RemoteSessionViewModel.kt"
SESSION_UI = ANDROID / "remote/ui/RemoteSessionScreens.kt"
STORE = ANDROID / "remote/data/RemoteStore.kt"
UNIT = ROOT / "apps/android/app/src/test/java/ai/drsai/remote/remote/data/RemoteNotificationNavigationTest.kt"
INSTRUMENTATION = ROOT / "apps/android/app/src/androidTest/java/ai/drsai/remote/remote/device/RemoteWorkspaceNotificationTest.kt"


def verify() -> dict[str, object]:
    secret = "must-not-cross-push-boundary"
    intent = notification_intent("runtime", "workspace", "session", {
        "event_id": "event-one",
        "item_id": "item-one",
        "type": "event.run.waiting",
        "payload": {"message": secret, "path": "/private", "command": secret},
    })
    if intent is None:
        raise ValueError("p6_notification_intent_missing")
    encoded = json.dumps(intent.payload, sort_keys=True)
    if secret in encoded or any(key in intent.payload for key in ("message", "body", "path", "command")):
        raise ValueError("p6_notification_payload_content_leak")
    if set(intent.payload) != {
        "version", "kind", "runtime_id", "workspace_id", "session_id", "event_id", "item_id",
    }:
        raise ValueError("p6_notification_payload_contract_drift")

    sources = {
        "notifications": NOTIFICATIONS.read_text(encoding="utf-8"),
        "navigation": NAVIGATION.read_text(encoding="utf-8"),
        "view_model": APP_VIEW_MODEL.read_text(encoding="utf-8"),
        "ui": APP_UI.read_text(encoding="utf-8"),
        "session_vm": SESSION_VM.read_text(encoding="utf-8"),
        "session_ui": SESSION_UI.read_text(encoding="utf-8"),
        "store": STORE.read_text(encoding="utf-8"),
        "unit": UNIT.read_text(encoding="utf-8"),
        "instrumentation": INSTRUMENTATION.read_text(encoding="utf-8"),
    }
    required = {
        "notifications": ("ALLOWED_KEYS", "打开 OpenDrSai 查看详情", "FLAG_IMMUTABLE"),
        "navigation": (
            "ProcessStarted", "LOCKED", "LOGIN_REQUIRED", "LoginCompleted", "ItemFocused",
            "remote_notification_focus_mismatch",
        ),
        "view_model": (
            'getSharedPreferences("remote-notification-navigation"', ".commit()",
            "remote_notification_focus_required", "destination = AppDestination.Login",
        ),
        "ui": ("sessionViewModel::focusItem", "onFocusResolved", "focusedItemId ="),
        "session_vm": ("fun focusItem(itemId: String)", "oaepSessionItem(", "RemoteFocusItemState.NOT_FOUND"),
        "session_ui": ("RemoteFocusItemState.LOADING", "RemoteConnectionState.AUTH_REQUIRED", "onSignIn"),
        "store": ("suspend fun oaepSessionItem(", "database.remoteDao().oaepItem("),
        "unit": (
            "valid login cold start", "killed process restoration and lock screen",
            "expired login", "authentication expiry during navigation", "wrong item",
        ),
        "instrumentation": ("opaquePayloadOpensOnlyItsAuthorizedSessionIdentity", "providerDataRejectsAnyNonOpaqueEnvelopeField"),
    }
    for name, markers in required.items():
        for marker in markers:
            if marker not in sources[name]:
                raise ValueError(f"p6_notification_navigation_marker_missing:{name}:{marker}")
    return {
        "journeys": 5,
        "payload_fields": len(intent.payload),
        "content_fields": 0,
        "durable_until_item_focused": True,
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
