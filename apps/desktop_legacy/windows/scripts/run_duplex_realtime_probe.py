"""Run the Gateway's bounded, redacted Realtime Provider handshake probe.

This command deliberately reports only the public probe contract. Provider
URLs, credentials, exception text, and raw upstream events are never emitted.
It proves a real session handshake, not end-to-end microphone/audio acceptance.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
from pathlib import Path


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--home", type=Path, required=True)
    parser.add_argument("--agent", default="opendrsai")
    parser.add_argument("--output", type=Path)
    return parser.parse_args()


async def run() -> int:
    args = parse_args()
    home = args.home.expanduser().resolve()
    os.environ["DRSAI_HOME"] = str(home)

    # Import after DRSAI_HOME is fixed because Gateway configuration paths are
    # intentionally resolved at module load time.
    from drsai.backend.gateway import probe_agent_realtime_voice

    raw = await probe_agent_realtime_voice(args.agent, force=True)
    public = {
        "schemaVersion": 1,
        "kind": "realtime-provider-handshake",
        "agentId": args.agent,
        "status": raw.get("status"),
        "providerId": raw.get("provider_id"),
        "modelId": raw.get("model_id"),
        "checkedAt": raw.get("checked_at"),
        "expiresAt": raw.get("expires_at"),
        "evidenceKind": raw.get("evidence_kind"),
        "capabilities": raw.get("capabilities") if isinstance(raw.get("capabilities"), dict) else {},
        "errorCode": raw.get("error_code"),
    }
    encoded = json.dumps(public, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        output = args.output.resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        output.write_text(encoded, encoding="utf-8")
    print(encoded, end="")
    return 0 if public["status"] == "verified" else 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(run()))
