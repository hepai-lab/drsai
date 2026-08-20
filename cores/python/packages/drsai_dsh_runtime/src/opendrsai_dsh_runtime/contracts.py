"""Pinned public protocol identities used by the standalone bridge.

The constants are generated from OpenDrSai's protocol sources. Keeping them in
this independent distribution prevents a runtime installation from importing
the product Runtime Engine merely to negotiate a wire contract.
"""

from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from typing import Any


OAEP_VERSION = "1.0"
OAEP_PROFILE = "oaep.session-stream/1"
OAEP_SCHEMA_SHA256 = "e207c75c2f37e121dc613aec040c24fd5bd2c6f4f005826c8996a6bb848770b7"

CONTROL_VERSION = "1"
CONTROL_SCHEMA_SHA256 = "450d0f1487ef847d4ffe096d3f4972d9f70e2c6094b48832aa583a37b982510f"

BRIDGE_SERVER_NAME = "opendrsai-dsh-oaep-runtime"
NATIVE_SERVER_NAME = "deepseek-harness-sdk-runtime"


def canonical_json_sha256(value: Mapping[str, Any]) -> str:
    """Return a stable SHA-256 for a JSON object without leaking its content."""

    encoded = json.dumps(
        value,
        ensure_ascii=False,
        allow_nan=False,
        sort_keys=True,
        separators=(",", ":"),
    ).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def runtime_protocol_description() -> dict[str, Any]:
    """Return the exact northbound protocol identity advertised by P1."""

    return {
        "control": {
            "version": CONTROL_VERSION,
            "schema_sha256": CONTROL_SCHEMA_SHA256,
        },
        "oaep": {
            "version": OAEP_VERSION,
            "profiles": [OAEP_PROFILE],
            "schema_sha256": OAEP_SCHEMA_SHA256,
        },
        "owop": {"supported": False},
    }
