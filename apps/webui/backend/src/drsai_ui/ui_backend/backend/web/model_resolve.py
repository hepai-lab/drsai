"""Shared helpers to resolve model alias from websocket / input payloads."""
from __future__ import annotations

import json
from typing import Any


def _as_dict(value: Any) -> dict | None:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else None
        except (json.JSONDecodeError, TypeError):
            return None
    return None


def resolve_requested_model(
    *,
    message: dict | None = None,
    metadata: dict | None = None,
    settings_config: dict | None = None,
    response: str | dict | None = None,
) -> str | None:
    """
    Resolve model alias from websocket payload.

    Checks message, metadata, settings_config, agent_mode_config, and
    input_response JSON body (defult_config_name in response string).
    """
    candidates: list[dict | None] = []

    for container in (message, metadata, settings_config):
        d = _as_dict(container)
        if d:
            candidates.append(d)

    for container in (settings_config, metadata, message):
        d = _as_dict(container)
        if d:
            amc = _as_dict(d.get("agent_mode_config"))
            if amc:
                candidates.append(amc)

    response_dict = _as_dict(response)
    if response_dict:
        candidates.append(response_dict)
    elif isinstance(response, str):
        candidates.append(_as_dict(response))

    for src in candidates:
        if not src:
            continue
        alias = src.get("defult_config_name") or src.get("default_config_name")
        if alias and str(alias).strip():
            return str(alias).strip()
    return None


def apply_requested_model(settings_config: dict, requested_model: str) -> None:
    """Propagate model alias for connection.py / teammanager downstream."""
    settings_config["defult_config_name"] = requested_model
    amc = _as_dict(settings_config.get("agent_mode_config"))
    if amc:
        settings_config["agent_mode_config"] = {
            **amc,
            "defult_config_name": requested_model,
        }
    else:
        settings_config["agent_mode_config"] = {"defult_config_name": requested_model}


def settings_config_from_input_response(response: str | dict | None) -> dict[str, Any] | None:
    """Build a settings_config dict from a websocket input_response payload.

    Returns None when no model alias or settings_config could be resolved.
    """
    if response is None:
        return None

    metadata: dict | None = None
    response_body: str | dict | None = None
    if isinstance(response, dict):
        metadata = _as_dict(response.get("metadata"))
        inner = response.get("response")
        if isinstance(inner, str):
            response_body = inner
        else:
            response_body = _as_dict(inner) or response
    else:
        response_body = response

    settings_config = _as_dict((metadata or {}).get("settings_config")) or {}
    alias = resolve_requested_model(
        metadata=metadata,
        settings_config=settings_config,
        response=response_body,
    )
    if not alias:
        return None

    apply_requested_model(settings_config, alias)
    return settings_config
