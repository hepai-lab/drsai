"""Android Host adapter for the shared production Agent Kernel."""

import json
import platform
import gc

from mobile_core import RuntimeEnvelope
from agent_kernel import production_capability_manifest
from agent_kernel_factory import create_agent_kernel, kernel_factory_identity


_core = create_agent_kernel(surface="android")
gc.collect()
try:
    import ctypes

    ctypes.CDLL("libc.so").malloc_trim(0)
except (AttributeError, OSError):
    # Not every supported libc exposes malloc_trim. Python GC above remains
    # the portable baseline and startup must never fail for this optimization.
    pass


def health() -> str:
    """Return only after the shared Python Core and its imports are initialized."""
    return json.dumps(
        {
            "python_version": platform.python_version(),
            "status": "python_runtime_ready",
            "agent_type": _core.agent_type,
            "agent_kernel": kernel_factory_identity(_core),
            "capability_manifest": production_capability_manifest("android"),
        },
        separators=(",", ":"),
        sort_keys=True,
    )


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
    _core = create_agent_kernel(surface="android")
