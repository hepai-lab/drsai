#!/usr/bin/env python3
"""Fail-closed, content-free preflight for P5 remote-workspace push.

The command validates configuration shape without printing configuration values.
It can be run independently at the Android build boundary, inside the Relay
process environment, or against the public Relay readiness endpoint.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
from pathlib import Path
import re
from typing import Mapping
from urllib.parse import urljoin, urlparse
from urllib.request import Request, urlopen


ANDROID_VARIABLES = (
    "OPENDRSAI_ANDROID_FIREBASE_API_KEY",
    "OPENDRSAI_ANDROID_FIREBASE_APPLICATION_ID",
    "OPENDRSAI_ANDROID_FIREBASE_PROJECT_ID",
    "OPENDRSAI_ANDROID_FIREBASE_SENDER_ID",
)
RELAY_VARIABLES = (
    "HAI_RUNTIME_RELAY_FCM_PROJECT_ID",
    "GOOGLE_APPLICATION_CREDENTIALS",
    "HAI_RUNTIME_RELAY_PUSH_TOKEN_KEYS",
    "HAI_RUNTIME_RELAY_PUSH_TOKEN_ACTIVE_KEY_ID",
)
READINESS_PATH = "v2/push/readiness"
PROJECT_ID = re.compile(r"^[a-z][a-z0-9-]{4,28}[a-z0-9]$")
APPLICATION_ID = re.compile(r"^\d+:\d+:android:[0-9a-fA-F]+$")


class PreflightError(RuntimeError):
    pass


def _require_nonempty(environment: Mapping[str, str], name: str) -> str:
    value = environment.get(name, "").strip()
    if not value:
        raise PreflightError(f"push_preflight_missing:{name}")
    return value


def _result(scope: str, names: tuple[str, ...], **extra: object) -> dict:
    return {
        "schema_version": "p5-push-preflight/1",
        "scope": scope,
        "checks": [{"name": name, "passed": True} for name in names],
        **extra,
        "passed": True,
    }


def check_android(environment: Mapping[str, str]) -> dict:
    values = {name: _require_nonempty(environment, name) for name in ANDROID_VARIABLES}
    if not APPLICATION_ID.fullmatch(values["OPENDRSAI_ANDROID_FIREBASE_APPLICATION_ID"]):
        raise PreflightError("push_preflight_invalid:firebase_application_id")
    if not PROJECT_ID.fullmatch(values["OPENDRSAI_ANDROID_FIREBASE_PROJECT_ID"]):
        raise PreflightError("push_preflight_invalid:firebase_project_id")
    if not values["OPENDRSAI_ANDROID_FIREBASE_SENDER_ID"].isdigit():
        raise PreflightError("push_preflight_invalid:firebase_sender_id")
    return _result("android", ANDROID_VARIABLES)


def _decode_key(value: str) -> bytes:
    padding = "=" * (-len(value) % 4)
    try:
        return base64.urlsafe_b64decode(value + padding)
    except (ValueError, TypeError) as exc:
        raise PreflightError("push_preflight_invalid:push_token_key") from exc


def check_relay(environment: Mapping[str, str]) -> dict:
    values = {name: _require_nonempty(environment, name) for name in RELAY_VARIABLES}
    if not PROJECT_ID.fullmatch(values["HAI_RUNTIME_RELAY_FCM_PROJECT_ID"]):
        raise PreflightError("push_preflight_invalid:fcm_project_id")
    credential_path = Path(values["GOOGLE_APPLICATION_CREDENTIALS"])
    if not credential_path.is_file():
        raise PreflightError("push_preflight_invalid:application_credentials")
    try:
        credentials = json.loads(credential_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise PreflightError("push_preflight_invalid:application_credentials") from exc
    if not isinstance(credentials, dict) \
            or credentials.get("type") != "service_account" \
            or credentials.get("project_id") != values["HAI_RUNTIME_RELAY_FCM_PROJECT_ID"] \
            or not isinstance(credentials.get("client_email"), str) \
            or not isinstance(credentials.get("private_key_id"), str) \
            or not isinstance(credentials.get("private_key"), str):
        raise PreflightError("push_preflight_invalid:application_credentials")
    try:
        keyring = json.loads(values["HAI_RUNTIME_RELAY_PUSH_TOKEN_KEYS"])
    except json.JSONDecodeError as exc:
        raise PreflightError("push_preflight_invalid:push_token_keyring") from exc
    if not isinstance(keyring, dict) or not keyring:
        raise PreflightError("push_preflight_invalid:push_token_keyring")
    if any(not isinstance(key_id, str) or not key_id or not isinstance(key, str)
           or len(_decode_key(key)) != 32 for key_id, key in keyring.items()):
        raise PreflightError("push_preflight_invalid:push_token_keyring")
    if values["HAI_RUNTIME_RELAY_PUSH_TOKEN_ACTIVE_KEY_ID"] not in keyring:
        raise PreflightError("push_preflight_invalid:push_token_active_key")
    return _result("relay", RELAY_VARIABLES, key_count=len(keyring))


def check_public(relay_url: str, *, require_ready: bool = True, timeout: float = 20) -> dict:
    base = relay_url.rstrip("/") + "/"
    parsed = urlparse(base)
    if parsed.scheme != "https" or not parsed.netloc:
        raise PreflightError("push_preflight_https_required")
    target = urljoin(base, READINESS_PATH)
    with urlopen(Request(target, headers={"Accept": "application/json"}), timeout=timeout) as response:
        status = getattr(response, "status", 200)
        final_url = response.geturl()
        raw = response.read()
    if status != 200 or urlparse(final_url).scheme != "https" or not raw:
        raise PreflightError("push_preflight_readiness_unavailable")
    try:
        payload = json.loads(raw)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise PreflightError("push_preflight_readiness_invalid") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("ready"), bool) \
            or not isinstance(payload.get("worker_running"), bool) \
            or not isinstance(payload.get("providers"), dict) \
            or not isinstance(payload["providers"].get("fcm"), bool):
        raise PreflightError("push_preflight_readiness_invalid")
    ready = bool(payload["ready"] and payload["providers"]["fcm"] and payload["worker_running"])
    if require_ready and not ready:
        raise PreflightError("push_preflight_provider_not_ready")
    return {
        "schema_version": "p5-push-preflight/1",
        "scope": "public",
        "checks": [
            {"name": "https", "passed": True},
            {"name": "schema", "passed": True},
            {"name": "provider_fcm", "passed": payload["providers"]["fcm"]},
            {"name": "worker_running", "passed": payload["worker_running"]},
        ],
        "readiness_path": "/api/runtime-relay/v2/push/readiness",
        "ready": ready,
        "passed": ready,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("scope", choices=("android", "relay", "public"))
    parser.add_argument("--relay-url", default="https://ai-dev.ihep.ac.cn/api/runtime-relay")
    parser.add_argument("--allow-not-ready", action="store_true")
    args = parser.parse_args(argv)
    try:
        if args.scope == "android":
            result = check_android(os.environ)
        elif args.scope == "relay":
            result = check_relay(os.environ)
        else:
            result = check_public(args.relay_url, require_ready=not args.allow_not_ready)
    except (PreflightError, OSError) as exc:
        print(json.dumps({
            "schema_version": "p5-push-preflight/1",
            "scope": args.scope,
            "passed": False,
            "error": str(exc),
        }, ensure_ascii=False, indent=2))
        return 1
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
