"""Minimal Android entry point used before the complete Core factory is wired."""

import json
import platform

from mobile_core import RuntimeEnvelope, create_shared_mobile_core


_core = create_shared_mobile_core(surface="android")


def execute(envelope_json: str) -> str:
    envelope = RuntimeEnvelope.from_json(envelope_json)
    outbound = _core.handle(envelope)
    return json.dumps(
        {
            "protocol_version": envelope.protocol_version,
            "request_id": envelope.request_id,
            "run_id": envelope.run_id,
            "python_version": platform.python_version(),
            "status": "python_runtime_ready",
            "outbound": [message.to_dict() for message in outbound],
        },
        separators=(",", ":"),
        sort_keys=True,
    )


def reset() -> None:
    """Drop every in-memory Run and idempotency cache before process shutdown/logout."""
    global _core
    _core = create_shared_mobile_core(surface="android")
