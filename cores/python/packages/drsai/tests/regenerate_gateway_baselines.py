"""Regenerate the gateway refactor baselines.

    python cores/python/packages/drsai/tests/regenerate_gateway_baselines.py

Run this ONLY for a deliberate, reviewed contract change -- for example the
planned deletion of dead routes in P1. Never run it to turn a red baseline
green: the diff against the previous fixture is the entire point of the safety
net, and a supposedly behaviour-preserving move must produce no diff at all.

The PR that regenerates a baseline must state, in its description, what changed
and which clients are affected. See
``docs/desktop/gateway-modularization-plan.zh-CN.md``.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from test_gateway_refactor_baseline import (  # noqa: E402
    OPENAPI_PATHS_BASELINE,
    ROUTE_ORDER_BASELINE,
    flatten_routes,
    openapi_paths,
)

from drsai.backend import gateway  # noqa: E402


def main() -> None:
    OPENAPI_PATHS_BASELINE.parent.mkdir(parents=True, exist_ok=True)

    paths = openapi_paths()
    OPENAPI_PATHS_BASELINE.write_text(
        json.dumps(paths, indent=2, sort_keys=True, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    # Registration order is the contract here, so this file is deliberately not
    # sorted.
    order = flatten_routes(gateway.app.routes)
    ROUTE_ORDER_BASELINE.write_text(
        json.dumps(order, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )

    print(f"OpenAPI paths : {len(paths):>4}  -> {OPENAPI_PATHS_BASELINE.name}")
    print(f"Ordered routes: {len(order):>4}  -> {ROUTE_ORDER_BASELINE.name}")


if __name__ == "__main__":
    main()
