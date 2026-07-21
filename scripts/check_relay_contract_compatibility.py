"""Fail when a stable Relay endpoint/capability or error/event field disappears."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
schema = json.loads((ROOT / "protocol/relay/runtime-relay.schema.json").read_text(encoding="utf-8"))
baseline = json.loads((ROOT / "protocol/relay/runtime-relay.compat.json").read_text(encoding="utf-8"))

checks = {
    "endpoints": set(schema["x-relay-endpoints"]),
    "capabilities": set(schema["x-relay-capabilities"]),
    "error_required": set(schema["$defs"]["error"]["required"]),
    "event_required": set(schema["$defs"]["event"]["required"]),
}
for name, current in checks.items():
    removed = set(baseline[name]) - current
    if removed:
        raise SystemExit(f"Breaking Relay contract change in {name}: removed {sorted(removed)}")
