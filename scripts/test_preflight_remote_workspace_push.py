from __future__ import annotations

import base64
import io
import json
from pathlib import Path
from unittest.mock import patch

import pytest

from preflight_remote_workspace_push import (
    PreflightError,
    check_android,
    check_public,
    check_relay,
)


def test_android_configuration_is_validated_without_values() -> None:
    environment = {
        "OPENDRSAI_ANDROID_FIREBASE_API_KEY": "private-api-key",
        "OPENDRSAI_ANDROID_FIREBASE_APPLICATION_ID": "1:2:android:abcdef",
        "OPENDRSAI_ANDROID_FIREBASE_PROJECT_ID": "opendrsai-dev",
        "OPENDRSAI_ANDROID_FIREBASE_SENDER_ID": "123456789",
    }
    result = check_android(environment)
    serialized = json.dumps(result)
    assert result["passed"] is True
    assert "private-api-key" not in serialized


def test_android_missing_configuration_fails_closed() -> None:
    with pytest.raises(PreflightError, match="push_preflight_missing"):
        check_android({})


def test_relay_keyring_and_active_key_are_validated(tmp_path: Path) -> None:
    credentials = tmp_path / "service-account.json"
    credentials.write_text(json.dumps({
        "type": "service_account",
        "project_id": "opendrsai-dev",
        "client_email": "relay@example.invalid",
        "private_key_id": "test-key-id",
        "private_key": "test-private-key",
    }), encoding="utf-8")
    encoded = base64.urlsafe_b64encode(b"k" * 32).decode().rstrip("=")
    environment = {
        "HAI_RUNTIME_RELAY_FCM_PROJECT_ID": "opendrsai-dev",
        "GOOGLE_APPLICATION_CREDENTIALS": str(credentials),
        "HAI_RUNTIME_RELAY_PUSH_TOKEN_KEYS": json.dumps({"v1": encoded}),
        "HAI_RUNTIME_RELAY_PUSH_TOKEN_ACTIVE_KEY_ID": "v1",
    }
    result = check_relay(environment)
    serialized = json.dumps(result)
    assert result["key_count"] == 1
    assert encoded not in serialized
    assert str(credentials) not in serialized


def test_relay_rejects_wrong_key_length(tmp_path: Path) -> None:
    credentials = tmp_path / "service-account.json"
    credentials.write_text(json.dumps({
        "type": "service_account",
        "project_id": "opendrsai-dev",
        "client_email": "relay@example.invalid",
        "private_key_id": "test-key-id",
        "private_key": "test-private-key",
    }), encoding="utf-8")
    environment = {
        "HAI_RUNTIME_RELAY_FCM_PROJECT_ID": "opendrsai-dev",
        "GOOGLE_APPLICATION_CREDENTIALS": str(credentials),
        "HAI_RUNTIME_RELAY_PUSH_TOKEN_KEYS": json.dumps({"v1": "c2hvcnQ"}),
        "HAI_RUNTIME_RELAY_PUSH_TOKEN_ACTIVE_KEY_ID": "v1",
    }
    with pytest.raises(PreflightError, match="push_token_keyring"):
        check_relay(environment)


def test_relay_rejects_credentials_for_another_project(tmp_path: Path) -> None:
    credentials = tmp_path / "service-account.json"
    credentials.write_text(json.dumps({
        "type": "service_account",
        "project_id": "another-project",
        "client_email": "relay@example.invalid",
        "private_key_id": "test-key-id",
        "private_key": "test-private-key",
    }), encoding="utf-8")
    encoded = base64.urlsafe_b64encode(b"k" * 32).decode().rstrip("=")
    environment = {
        "HAI_RUNTIME_RELAY_FCM_PROJECT_ID": "opendrsai-dev",
        "GOOGLE_APPLICATION_CREDENTIALS": str(credentials),
        "HAI_RUNTIME_RELAY_PUSH_TOKEN_KEYS": json.dumps({"v1": encoded}),
        "HAI_RUNTIME_RELAY_PUSH_TOKEN_ACTIVE_KEY_ID": "v1",
    }
    with pytest.raises(PreflightError, match="application_credentials"):
        check_relay(environment)


class _Response:
    status = 200

    def __init__(self, payload: dict) -> None:
        self._raw = json.dumps(payload).encode()

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self) -> bytes:
        return self._raw

    def geturl(self) -> str:
        return "https://example.test/api/runtime-relay/v2/push/readiness"


def test_public_readiness_requires_all_three_signals() -> None:
    payload = {"ready": True, "providers": {"fcm": True}, "worker_running": True}
    with patch("preflight_remote_workspace_push.urlopen", return_value=_Response(payload)):
        result = check_public("https://example.test/api/runtime-relay")
    assert result["ready"] is True


def test_public_readiness_rejects_not_ready() -> None:
    payload = {"ready": False, "providers": {"fcm": False}, "worker_running": True}
    with patch("preflight_remote_workspace_push.urlopen", return_value=_Response(payload)):
        with pytest.raises(PreflightError, match="provider_not_ready"):
            check_public("https://example.test/api/runtime-relay")


def test_public_diagnostic_does_not_claim_unready_provider_passed() -> None:
    payload = {"ready": False, "providers": {"fcm": False}, "worker_running": True}
    with patch("preflight_remote_workspace_push.urlopen", return_value=_Response(payload)):
        result = check_public("https://example.test/api/runtime-relay", require_ready=False)
    assert result["passed"] is False
    assert result["checks"][2] == {"name": "provider_fcm", "passed": False}


def test_public_readiness_rejects_http() -> None:
    with pytest.raises(PreflightError, match="https_required"):
        check_public("http://example.test/api/runtime-relay")
