"""Generate/check the Relay OpenAPI document from the typed FastAPI surface."""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = ROOT / "cores/python/packages/drsai/src"
OUTPUT = ROOT / "cores/protocol/relay/runtime-relay.openapi.json"
sys.path.insert(0, str(PACKAGE))

from drsai.relay.api import create_relay_app  # noqa: E402


def render() -> str:
    return json.dumps(create_relay_app().openapi(), ensure_ascii=False, indent=2, sort_keys=True) + "\n"


def main(check: bool = False) -> int:
    expected = render()
    if check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != expected:
            raise SystemExit("Relay OpenAPI drift: run scripts/generate_relay_openapi.py")
    else:
        OUTPUT.write_text(expected, encoding="utf-8", newline="\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main("--check" in sys.argv))
