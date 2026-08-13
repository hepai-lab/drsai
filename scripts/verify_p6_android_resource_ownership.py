#!/usr/bin/env python3
"""Verify bounded, process-owned Android remote-workspace resources."""
from __future__ import annotations

import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "apps/android/app/src/main/java/ai/drsai/remote/remote/data"
CONTAINER = DATA / "RemoteWorkspaceContainer.kt"
REGISTRY = DATA / "RemoteResourceLeaseRegistry.kt"
SSE = DATA / "RelaySseClient.kt"
SINGLE_FLIGHT = DATA / "RemoteSingleFlight.kt"
LATENCY = DATA / "RemoteLatencyTracker.kt"
REGISTRY_TEST = ROOT / "apps/android/app/src/test/java/ai/drsai/remote/RemoteResourceLeaseRegistryTest.kt"
SSE_TEST = ROOT / "apps/android/app/src/test/java/ai/drsai/remote/RelaySseClientTest.kt"
LATENCY_TEST = ROOT / "apps/android/app/src/test/java/ai/drsai/remote/RemoteLatencyTrackerTest.kt"

REQUIRED_OWNERS = {
    "database": 1,
    "http": 64,
    "sse_stream": 8,
    "token_refresh": 1,
    "device_proof": 1,
    "latency_tracker": 4096,
    "connectivity": 1,
    "single_flight": 128,
    "session_sync": 2,
}


def verify() -> dict[str, object]:
    sources = {
        path: path.read_text(encoding="utf-8")
        for path in (CONTAINER, REGISTRY, SSE, SINGLE_FLIGHT, LATENCY,
                     REGISTRY_TEST, SSE_TEST, LATENCY_TEST)
    }
    container = sources[CONTAINER]
    for name, capacity in REQUIRED_OWNERS.items():
        if capacity == 1:
            pattern = rf'registerOwner\("{re.escape(name)}",\s*[^,\n)]+\)'
        else:
            pattern = rf'registerOwner\("{re.escape(name)}",\s*[^,\n)]+,\s*capacity\s*=\s*{capacity}\)'
        if not re.search(pattern, container):
            raise ValueError(f"p6_resource_owner_missing:{name}:{capacity}")
    for resource in ("tokenStore", "auth", "deviceProof", "http", "database", "repository", "stream"):
        if not re.search(rf"private val {resource}\b", container):
            raise ValueError(f"p6_resource_exposed:{resource}")

    registry = sources[REGISTRY]
    for marker in (
        "resource_owner_conflict", "resource_owner_required",
        "resource_capacity_exceeded", "resource_catalog_capacity_exceeded",
        "ownerCount = 1", "MAX_RESOURCE_CAPACITY = 4096",
    ):
        if marker not in registry:
            raise ValueError(f"p6_resource_registry_unbounded:{marker}")

    sse = sources[SSE]
    if sse.count('resources?.acquire("sse_stream")') != 4:
        raise ValueError("p6_sse_lease_surface_incomplete")
    if sse.count("resourceLease?.close()") != 4:
        raise ValueError("p6_sse_lease_release_incomplete")
    if "capacity: Int = 128" not in sources[SINGLE_FLIGHT] or "single_flight_capacity_exceeded" not in sources[SINGLE_FLIGHT]:
        raise ValueError("p6_single_flight_unbounded")
    if "capacity: Int = 4096" not in sources[LATENCY] or "while (receivedAtMs.size > capacity)" not in sources[LATENCY]:
        raise ValueError("p6_latency_tracker_unbounded")

    tests = "\n".join(sources[path] for path in (REGISTRY_TEST, SSE_TEST, LATENCY_TEST))
    for marker in (
        "repeat(100)", "account and network transitions", "second owner and lease above capacity",
        "completed stream returns its bounded process lease", "repeat(10_000)",
    ):
        if marker not in tests:
            raise ValueError(f"p6_resource_acceptance_missing:{marker}")
    return {
        "process_owners": len(REQUIRED_OWNERS),
        "sse_surfaces": 4,
        "page_account_network_cycles": 100,
        "latency_events": 10_000,
        "passed": True,
    }


def main() -> int:
    try:
        value = verify()
    except (OSError, ValueError) as exc:
        raise SystemExit(str(exc)) from exc
    print(json.dumps(value, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
